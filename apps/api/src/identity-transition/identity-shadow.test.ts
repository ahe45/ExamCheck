import { describe, expect, it } from "vitest";
import { compareIdentityProjections, createProjectionDigest, type ShadowProjectionRow } from "./identity-shadow.js";

const SALT = "synthetic-shadow-salt-v1";

describe("identity transition shadow comparison", () => {
  it("uses stable salted digests so object key order does not create a mismatch", () => {
    const oldProjection = { name: "홍길동", schedule: { date: "2026-09-01", period: "1교시" }, assigned: true };
    const newProjection = { assigned: true, schedule: { period: "1교시", date: "2026-09-01" }, name: "홍길동" };

    const report = compareIdentityProjections([row(1, oldProjection)], [row(1, newProjection)], SALT);

    expect(report.counts).toEqual({ match: 1, mismatch: 0, oldOnly: 0, newOnly: 0, ambiguous: 0 });
    expect(report.entries[0]).toMatchObject({ entityId: 1, status: "MATCH", oldRowCount: 1, newRowCount: 1 });
    expect(report.entries[0]?.oldDigest).toBe(report.entries[0]?.newDigest);
    expect(report.entries[0]?.oldDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reports mismatched, one-sided and ambiguous entities without returning projection values", () => {
    const oldRows = [
      row(1, { status: "대기", examineeNo: "PRIVATE-001" }),
      row(2, { status: "구버전에만존재" }),
      row(4, { status: "중복-A" }),
      row(4, { status: "중복-B" }),
    ];
    const newRows = [
      row(1, { status: "완료", examineeNo: "PRIVATE-001" }),
      row(3, { status: "신버전에만존재" }),
      row(4, { status: "하나" }),
    ];

    const report = compareIdentityProjections(oldRows, newRows, SALT);

    expect(report.counts).toEqual({ match: 0, mismatch: 1, oldOnly: 1, newOnly: 1, ambiguous: 1 });
    expect(report.entries.map(({ entityId, status }) => ({ entityId, status }))).toEqual([
      { entityId: 1, status: "MISMATCH" },
      { entityId: 2, status: "OLD_ONLY" },
      { entityId: 3, status: "NEW_ONLY" },
      { entityId: 4, status: "AMBIGUOUS" },
    ]);
    const serialized = JSON.stringify(report);
    for (const privateValue of ["PRIVATE-001", "대기", "완료", "구버전에만존재", "신버전에만존재", "중복-A"]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("domain-separates digests by entity and salt and rejects an unsafely short salt", () => {
    const projection = { examineeNo: "PRIVATE-009", name: "비공개 성명", birthDate: "2002-03-04" };

    expect(createProjectionDigest(1, projection, SALT)).not.toBe(createProjectionDigest(2, projection, SALT));
    expect(createProjectionDigest(1, projection, SALT)).not.toBe(
      createProjectionDigest(1, projection, "different-shadow-salt-v1"),
    );
    expect(() => compareIdentityProjections([], [], "short")).toThrow("at least 16 bytes");
  });

  it("supports non-PII string source bridges such as print job UUIDs", () => {
    const printJobId = "108ab21f-4f86-4f8e-9e4d-7731cb0c87ef";
    const report = compareIdentityProjections(
      [{ entityId: printJobId, projection: { status: "CREATED" } }],
      [{ entityId: printJobId, projection: { status: "CREATED" } }],
      SALT,
    );

    expect(report.counts.match).toBe(1);
    expect(report.entries[0]?.entityId).toBe(printJobId);
    expect(() => createProjectionDigest("unsafe bridge id", { status: "CREATED" }, SALT)).toThrow("safe bridge");
  });

  it("does not serialize raw PII even when both projections match", () => {
    const privateProjection = {
      examineeNo: "RAW-EXAMINEE-777",
      name: "외부노출금지성명",
      birthDate: "1998-07-06",
      nested: { room: "비공개고사실" },
    };
    const report = compareIdentityProjections([row(77, privateProjection)], [row(77, privateProjection)], SALT);
    const serialized = JSON.stringify(report);

    for (const value of ["RAW-EXAMINEE-777", "외부노출금지성명", "1998-07-06", "비공개고사실"]) {
      expect(serialized).not.toContain(value);
    }
    expect(serialized).toContain('"digestAlgorithm":"hmac-sha256"');
  });
});

function row(entityId: number, projection: ShadowProjectionRow["projection"]): ShadowProjectionRow {
  return { entityId, projection };
}
