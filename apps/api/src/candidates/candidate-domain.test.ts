import { describe, expect, it } from "vitest";
import {
  CandidateDomainError,
  assertCandidateUploadPolicy,
  assertCandidateNumberUniqueness,
  buildCandidateImportPlan,
  buildCandidatePhotoImportPlan,
  buildCandidatePreview,
  hasCandidateOperationalChanges,
  matchCandidatePhotos,
  normalizeAndValidateCandidate,
  type CandidatePhotoArchiveFiles,
  type CandidateRecord,
} from "./candidate-domain.js";
import { candidateKey, type CandidateInput } from "./candidate-fields.js";

describe("candidate domain", () => {
  it("normalizes text and validates dates and times without mutating the source", () => {
    const source = candidate({ name: "  홍길동  ", date: "2026-02-28", time: "09:30" });
    const normalized = normalizeAndValidateCandidate(source, 2);

    expect(normalized.name).toBe("홍길동");
    expect(source.name).toBe("  홍길동  ");
    expect(() => normalizeAndValidateCandidate(candidate({ date: "2026-02-30" }), 7)).toThrow(
      "시험날짜 형식은 yyyy-mm-dd여야 합니다. (7행)",
    );
    expect(() => normalizeAndValidateCandidate(candidate({ time: "24:00" }), 8)).toThrow(
      "시험시간 형식은 hh:mm이어야 합니다. (8행)",
    );
  });

  it("rejects unknown workbook and photo policies with their existing messages", () => {
    expect(() => assertCandidateUploadPolicy("replace", "workbook")).toThrow(CandidateDomainError);
    expect(() => assertCandidateUploadPolicy("replace", "workbook")).toThrow("기존 데이터 처리 방식을 확인해 주세요.");
    expect(() => assertCandidateUploadPolicy("replace", "photo")).toThrow("기존 사진 처리 방식을 확인해 주세요.");
  });

  it("builds the same insert, update, skip and preview counts for every workbook policy", () => {
    const unchanged = record(1, candidate({ examineeNo: "10001" }));
    const changed = record(2, candidate({ examineeNo: "10002", name: "기존 이름" }));
    const existing = new Map([
      [candidateKey(unchanged), unchanged],
      [candidateKey(changed), changed],
    ]);
    const input = [
      candidate({ examineeNo: "10001" }),
      candidate({ examineeNo: "10002", name: "변경 이름" }),
      candidate({ examineeNo: "10003" }),
    ];

    expect(buildCandidatePreview(input, existing)).toEqual({
      totalRows: 3,
      insertCount: 1,
      updateCount: 1,
      unchangedCount: 1,
    });
    expect(buildCandidateImportPlan(input, existing, "insert-only")).toMatchObject({
      inserted: 1,
      updated: 0,
      skipped: 2,
    });
    expect(buildCandidateImportPlan(input, existing, "insert-update")).toMatchObject({
      inserted: 1,
      updated: 1,
      skipped: 1,
    });
    expect(buildCandidateImportPlan(input, existing, "all")).toMatchObject({
      inserted: 1,
      updated: 2,
      skipped: 0,
    });
  });

  it("distinguishes assignment-critical candidate changes from ordinary profile updates", () => {
    const current = candidate();
    expect(hasCandidateOperationalChanges(current, candidate({ name: "변경 이름", birth: "2001-01-01" }))).toBe(false);
    expect(hasCandidateOperationalChanges(current, candidate({ admission: "특별전형" }))).toBe(true);
    expect(hasCandidateOperationalChanges(current, candidate({ room: "102호" }))).toBe(true);
    expect(hasCandidateOperationalChanges(current, candidate({ temporaryNo: "0099" }))).toBe(true);
  });

  it("allows one identity in multiple schedules but rejects conflicting personal data", () => {
    const first = candidate({ examineeNo: "10001", time: "09:00", period: "1교시" });
    const second = candidate({ examineeNo: "10001", time: "13:00", period: "2교시" });
    expect(() => assertCandidateNumberUniqueness([first, second], new Map(), "SCHEDULE")).not.toThrow();

    expect(() =>
      assertCandidateNumberUniqueness(
        [first, { ...second, name: "다른 사람", birth: "2001-01-01" }],
        new Map(),
        "SCHEDULE",
      ),
    ).toThrow("같은 수험번호에 서로 다른 성명 또는 생년월일");
  });

  it("rejects a new schedule when its identity conflicts with an existing candidate record", () => {
    const existingCandidate = record(
      17,
      candidate({ examineeNo: "10001", time: "09:00", period: "1교시", name: "기존 수험생" }),
    );
    const existing = new Map([[candidateKey(existingCandidate), existingCandidate]]);

    expect(() =>
      assertCandidateNumberUniqueness(
        [candidate({ examineeNo: "10001", time: "13:00", period: "2교시", name: "다른 수험생" })],
        existing,
        "SCHEDULE",
      ),
    ).toThrow("같은 수험번호에 서로 다른 성명 또는 생년월일");
  });

  it("matches exact and embedded numbers, keeps longest-number precedence, and counts duplicates", () => {
    const archive: CandidatePhotoArchiveFiles = {
      totalFiles: 5,
      skippedCount: 1,
      files: [
        photo("10001.png", "a"),
        photo("portrait-100010.jpg", "b"),
        photo("copy-10001.jpeg", "c"),
        photo("unknown.png", "d"),
      ],
    };
    const matches = matchCandidatePhotos(archive, [
      { id: 1, examineeNo: "10001", photoHash: null },
      { id: 2, examineeNo: "100010", photoHash: "old" },
    ]);

    expect(matches.photos.map((item) => item.candidateRows[0]?.id)).toEqual([1, 2]);
    expect(matches.skippedCount).toBe(2);
    expect(matches.duplicateCount).toBe(1);
  });

  it("preserves photo upload policy counts and per-record insert-only behavior", () => {
    const archive = {
      totalFiles: 4,
      skippedCount: 1,
      duplicateCount: 0,
      photos: [
        { ...photo("10001.png", "same"), candidateRows: [{ id: 1, examineeNo: "10001", photoHash: "same" }] },
        { ...photo("10002.png", "new"), candidateRows: [{ id: 2, examineeNo: "10002", photoHash: null }] },
        {
          ...photo("10003.png", "changed"),
          candidateRows: [
            { id: 3, examineeNo: "10003", photoHash: "old" },
            { id: 4, examineeNo: "10003", photoHash: null },
          ],
        },
      ],
    };

    expect(buildCandidatePhotoImportPlan(archive, "insert-only")).toMatchObject({
      uploaded: 1,
      updated: 0,
      skipped: 3,
    });
    expect(buildCandidatePhotoImportPlan(archive, "insert-update")).toMatchObject({
      uploaded: 1,
      updated: 1,
      skipped: 2,
    });
    expect(buildCandidatePhotoImportPlan(archive, "all")).toMatchObject({ uploaded: 1, updated: 2, skipped: 1 });
  });
});

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    designatedSort: "",
    date: "2026-09-01",
    time: "09:00",
    period: "1교시",
    admission: "일반전형",
    unit: "디자인학부",
    major: "",
    building: "본관",
    room: "101호",
    examineeNo: "10001",
    temporaryNo: "",
    name: "홍길동",
    birth: "2000-01-01",
    group: "",
    opt1: "",
    opt2: "",
    opt3: "",
    ...overrides,
  };
}

function record(id: number, value: CandidateInput): CandidateRecord {
  return { ...value, id };
}

function photo(fileName: string, contentHash: string) {
  return {
    fileName,
    mimeType: fileName.endsWith(".png") ? ("image/png" as const) : ("image/jpeg" as const),
    content: Buffer.from(contentHash),
    contentHash,
  };
}
