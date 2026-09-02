import { describe, expect, it, vi } from "vitest";
import { compareIdentityProjections } from "./identity-shadow.js";
import {
  IDENTITY_SOURCE_MUTATION_AUDIT_EVENT_TYPES,
  IdentityShadowObservationRepository,
} from "./identity-shadow-observation.repository.js";

describe("identity shadow observation repository", () => {
  it("persists only aggregate counters and never projection values or per-entity digests", async () => {
    const execute = vi.fn().mockResolvedValue([{}, []]);
    const repository = new IdentityShadowObservationRepository();
    const privateValue = "RAW-PII-DO-NOT-PERSIST";
    const report = compareIdentityProjections(
      [{ entityId: 1, projection: { examineeNo: privateValue, status: "OLD" } }],
      [{ entityId: 1, projection: { examineeNo: privateValue, status: "NEW" } }],
      "0123456789abcdef0123456789abcdef",
    );

    await repository.record({ execute, query: vi.fn() } as never, {
      observationType: "candidate.detail",
      sourceHighWaterMark: 44,
      report,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, parameters] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("identity_shadow_observation");
    expect(parameters).toEqual([null, "candidate.detail", 44, 1, 1, 0, 1, 0, 0, 0]);
    const serializedCall = JSON.stringify(execute.mock.calls[0]);
    expect(serializedCall).not.toContain(privateValue);
    expect(serializedCall).not.toMatch(/[a-f0-9]{64}/);
  });

  it("rejects unsafe labels and counters before executing SQL", async () => {
    const execute = vi.fn();
    const repository = new IdentityShadowObservationRepository();
    const report = compareIdentityProjections([], [], "0123456789abcdef0123456789abcdef");

    await expect(
      repository.record({ execute, query: vi.fn() } as never, {
        observationType: "candidate detail contains spaces",
        sourceHighWaterMark: 0,
        report,
      }),
    ).rejects.toThrow("safe ASCII");
    expect(execute).not.toHaveBeenCalled();
  });

  it("completes only a uniquely typed UUID batch with the expected observation count", async () => {
    const batchId = "10000000-0000-4000-8000-000000000001";
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const repository = new IdentityShadowObservationRepository();
    const report = compareIdentityProjections([], [], "0123456789abcdef0123456789abcdef");

    await repository.startBatch({ execute, query: vi.fn() } as never, batchId);
    await repository.record({ execute, query: vi.fn() } as never, {
      verificationBatchId: batchId,
      observationType: "candidate.detail",
      sourceHighWaterMark: 0,
      report,
    });
    await repository.completeBatch({ execute, query: vi.fn() } as never, batchId, ["candidate.detail"]);

    expect(execute.mock.calls[1]?.[1]?.[0]).toBe(batchId);
    expect(execute.mock.calls[2]?.[0]).toContain("status = 'COMPLETED'");
  });

  it("rejects malformed or incomplete verification batches", async () => {
    const repository = new IdentityShadowObservationRepository();
    const executor = { execute: vi.fn().mockResolvedValue([{ affectedRows: 0 }, []]), query: vi.fn() } as never;

    await expect(repository.startBatch(executor, "not-a-uuid")).rejects.toThrow("must be UUIDs");
    await expect(
      repository.completeBatch(executor, "10000000-0000-4000-8000-000000000001", ["same", "same"]),
    ).rejects.toThrow("unique observation types");
    await expect(
      repository.completeBatch(executor, "10000000-0000-4000-8000-000000000001", ["candidate.detail"]),
    ).rejects.toThrow("incomplete");
  });

  it("reads the singleton mutation sequence and keeps authentication audits outside its contract", async () => {
    const query = vi.fn().mockResolvedValue([[{ sourceHighWaterMark: 17 }], []]);

    await expect(
      new IdentityShadowObservationRepository().loadSourceMutationHighWaterMark({
        query,
        execute: vi.fn(),
      } as never),
    ).resolves.toBe(17);

    expect(query.mock.calls[0]?.[0]).toContain("identity_source_mutation_watermark");
    expect(IDENTITY_SOURCE_MUTATION_AUDIT_EVENT_TYPES).toContain("CANDIDATE_WORKBOOK_IMPORTED");
    expect(IDENTITY_SOURCE_MUTATION_AUDIT_EVENT_TYPES).toContain("PRINT_JOB_CREATED");
    expect(IDENTITY_SOURCE_MUTATION_AUDIT_EVENT_TYPES).not.toContain("AUTH_LOGIN_SUCCEEDED" as never);
  });

  it("fails closed when the singleton mutation sequence is missing or unsafe", async () => {
    const repository = new IdentityShadowObservationRepository();

    await expect(
      repository.loadSourceMutationHighWaterMark({
        query: vi.fn().mockResolvedValue([[], []]),
        execute: vi.fn(),
      } as never),
    ).rejects.toThrow("high-water mark is invalid");
    await expect(
      repository.loadSourceMutationHighWaterMark({
        query: vi.fn().mockResolvedValue([[{ sourceHighWaterMark: Number.MAX_SAFE_INTEGER + 1 }], []]),
        execute: vi.fn(),
      } as never),
    ).rejects.toThrow("high-water mark is invalid");
  });
});
