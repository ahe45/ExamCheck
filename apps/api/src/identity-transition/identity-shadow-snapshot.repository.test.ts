import { describe, expect, it, vi } from "vitest";
import { compareIdentityProjections } from "./identity-shadow.js";
import {
  IDENTITY_SHADOW_OBSERVATION_TYPES,
  IdentityShadowSnapshotRepository,
} from "./identity-shadow-snapshot.repository.js";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("identity shadow snapshot repository", () => {
  it("loads every legacy/target domain through source bridge projections", async () => {
    const query = vi.fn().mockResolvedValue([[], []]);
    const snapshots = await new IdentityShadowSnapshotRepository().loadAll({ query, execute: vi.fn() } as never);

    expect(snapshots.map((snapshot) => snapshot.observationType)).toEqual(IDENTITY_SHADOW_OBSERVATION_TYPES);
    expect(snapshots).toHaveLength(9);
    expect(query).toHaveBeenCalledTimes(19);
    for (const call of query.mock.calls) {
      expect(call[0]).not.toMatch(/FOR UPDATE|LOCK IN SHARE MODE/i);
    }
  });

  it("compares candidate photo metadata and hashes without selecting the BLOB", async () => {
    const row = {
      entityId: 41,
      fileName: "private-candidate.jpg",
      mimeType: "IMAGE/JPEG",
      contentHash: "A".repeat(64),
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce([[row], []])
      .mockResolvedValueOnce([[row], []]);

    const snapshot = await new IdentityShadowSnapshotRepository().loadCandidatePhotos({
      query,
      execute: vi.fn(),
    } as never);
    const report = compareIdentityProjections(snapshot.legacyRows, snapshot.targetRows, SECRET);

    expect(report.counts.match).toBe(1);
    for (const [sql] of query.mock.calls as [string][]) {
      expect(sql).not.toMatch(/photo\.content(?:\s|,|$)/i);
    }
    expect(JSON.stringify(report)).not.toContain("private-candidate.jpg");
  });

  it("normalizes a candidate source row to the same target projection", async () => {
    const legacy = {
      entityId: 41,
      admissionName: "  전형 A ",
      admissionCode: " A-01 ",
      examDate: "2044-09-01",
      startTime: "09:00",
      endTime: "10:00",
      periodName: "  1교시 ",
      periodCode: " P-1 ",
      unitName: " 단위 ",
      unitCode: " U-1 ",
      majorName: " 전공 ",
      majorCode: " M-1 ",
      buildingName: " 본관 ",
      buildingCode: " B-1 ",
      roomName: " 101 ",
      roomCode: " R-1 ",
      examineeNo: "００４１",
      name: "  비공개 성명 ",
      birthDate: "2000-01-01",
      designatedSort: " 1 ",
      groupName: " G ",
      opt1: " A ",
      opt2: " B ",
      opt3: " C ",
      temporaryNo: "００７",
    };
    const target = {
      ...legacy,
      admissionName: "전형 A",
      admissionCode: "A-01",
      startTime: "09:00:00",
      endTime: "10:00:00",
      periodName: "1교시",
      periodCode: "P-1",
      unitName: "단위",
      unitCode: "U-1",
      majorName: "전공",
      majorCode: "M-1",
      buildingName: "본관",
      buildingCode: "B-1",
      roomName: "101",
      roomCode: "R-1",
      examineeNo: "0041",
      name: "비공개 성명",
      designatedSort: "1",
      groupName: "G",
      opt1: "A",
      opt2: "B",
      opt3: "C",
      temporaryNo: undefined,
      preassignedValue: 7,
      preassignedDisplayWidth: 3,
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce([[legacy], []])
      .mockResolvedValueOnce([[target], []]);

    const snapshot = await new IdentityShadowSnapshotRepository().loadCandidates({ query, execute: vi.fn() } as never);
    const report = compareIdentityProjections(snapshot.legacyRows, snapshot.targetRows, SECRET);

    expect(report.counts).toEqual({ match: 1, mismatch: 0, oldOnly: 0, newOnly: 0, ambiguous: 0 });
    expect(JSON.stringify(report)).not.toContain("비공개 성명");
  });

  it("uses the immutable print job UUID as a string source bridge", async () => {
    const entityId = "108ab21f-4f86-4f8e-9e4d-7731cb0c87ef";
    const projection = {
      projectionVersion: 1,
      sourceKind: "LEGACY_PRINT_JOB",
      jobNo: "JOB-1",
      labelType: "PSEUDONYM",
      businessRef: null,
      templateId: 1,
      copies: 1,
      payloadFormat: "ZPL",
      payload: "PRIVATE-ZPL-PAYLOAD",
      createdAt: "2044-09-01T09:00:00.000000Z",
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce([[{ entityId, ...projection }], []])
      .mockResolvedValueOnce([[{ entityId, projectionJson: JSON.stringify(projection) }], []]);

    const snapshot = await new IdentityShadowSnapshotRepository().loadPrintSnapshots({
      query,
      execute: vi.fn(),
    } as never);
    const report = compareIdentityProjections(snapshot.legacyRows, snapshot.targetRows, SECRET);

    expect(report.counts.match).toBe(1);
    expect(report.entries[0]?.entityId).toBe(entityId);
    expect(JSON.stringify(report)).not.toContain("PRIVATE-ZPL-PAYLOAD");
  });

  it("ignores stale legacy admission rows for unrestricted accounts but detects target scope leakage", async () => {
    const legacy = [{ entityId: 7, role: "ADMIN", enabled: 1, admissionName: "Stale Legacy Admission" }];
    const expectedTarget = [{ entityId: 7, role: "ADMIN", enabled: 1, scopeMode: "ALL", admissionName: null }];
    const matchingQuery = vi.fn().mockResolvedValueOnce([legacy, []]).mockResolvedValueOnce([expectedTarget, []]);
    const matchingSnapshot = await new IdentityShadowSnapshotRepository().loadAccounts({
      query: matchingQuery,
      execute: vi.fn(),
    } as never);

    expect(compareIdentityProjections(matchingSnapshot.legacyRows, matchingSnapshot.targetRows, SECRET).counts).toEqual(
      {
        match: 1,
        mismatch: 0,
        oldOnly: 0,
        newOnly: 0,
        ambiguous: 0,
      },
    );

    const leakingTarget = [{ ...expectedTarget[0], admissionName: "Unexpected Target Admission" }];
    const leakingQuery = vi.fn().mockResolvedValueOnce([legacy, []]).mockResolvedValueOnce([leakingTarget, []]);
    const leakingSnapshot = await new IdentityShadowSnapshotRepository().loadAccounts({
      query: leakingQuery,
      execute: vi.fn(),
    } as never);

    expect(
      compareIdentityProjections(leakingSnapshot.legacyRows, leakingSnapshot.targetRows, SECRET).counts.mismatch,
    ).toBe(1);
  });
});
