import { describe, expect, it, vi } from "vitest";
import type { IdentityShadowObservationRepository } from "./identity-shadow-observation.repository.js";
import type {
  IdentityShadowSnapshotPair,
  IdentityShadowSnapshotRepository,
} from "./identity-shadow-snapshot.repository.js";
import { IdentityShadowVerifier, type IdentityShadowVerificationConnection } from "./identity-shadow-verifier.js";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("isolated identity shadow verifier", () => {
  it("rejects HMAC secrets shorter than the runtime configuration minimum", async () => {
    const { verifier } = fixture([]);

    await expect(
      verifier.run(fakeConnection(), { confirmIsolatedCopy: true, hmacSecret: "0123456789abcdef" }),
    ).rejects.toThrow("at least 32 bytes");
  });

  it("compares and records every pair in one consistent snapshot without retaining PII", async () => {
    const privateValue = "RAW-PRIVATE-CANDIDATE";
    const pairs: IdentityShadowSnapshotPair[] = [
      {
        observationType: "identity-shadow.candidate.v1",
        sourceHighWaterMark: 4,
        legacyRows: [
          { entityId: 1, projection: { name: privateValue, state: "OLD" } },
          { entityId: 2, projection: { state: "OLD_ONLY" } },
          { entityId: 4, projection: { state: "A" } },
          { entityId: 4, projection: { state: "B" } },
        ],
        targetRows: [
          { entityId: 1, projection: { name: privateValue, state: "NEW" } },
          { entityId: 3, projection: { state: "NEW_ONLY" } },
          { entityId: 4, projection: { state: "A" } },
        ],
      },
    ];
    const { verifier, record } = fixture(pairs);
    const connection = fakeConnection();

    const report = await verifier.run(connection, { confirmIsolatedCopy: true, hmacSecret: SECRET });

    expect(report).toEqual({
      status: "MISMATCH",
      observations: [
        {
          observationType: "identity-shadow.candidate.v1",
          sourceHighWaterMark: 4,
          oldRowCount: 4,
          newRowCount: 3,
          counts: { match: 0, mismatch: 1, oldOnly: 1, newOnly: 1, ambiguous: 1 },
          matches: false,
        },
      ],
    });
    expect(connection.query).toHaveBeenNthCalledWith(2, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    expect(connection.query).toHaveBeenNthCalledWith(3, "START TRANSACTION WITH CONSISTENT SNAPSHOT");
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    const persistedReport = record.mock.calls[0]?.[1]?.report;
    expect(JSON.stringify(persistedReport)).not.toContain(privateValue);
  });

  it("is safely re-runnable and records a new aggregate observation each time", async () => {
    const pairs: IdentityShadowSnapshotPair[] = [
      {
        observationType: "identity-shadow.account-scope.v1",
        sourceHighWaterMark: 1,
        legacyRows: [{ entityId: 1, projection: { scope: "ALL" } }],
        targetRows: [{ entityId: 1, projection: { scope: "ALL" } }],
      },
    ];
    const { verifier, record } = fixture(pairs);
    const connection = fakeConnection();

    await expect(verifier.run(connection, { confirmIsolatedCopy: true, hmacSecret: SECRET })).resolves.toMatchObject({
      status: "MATCH",
    });
    await expect(verifier.run(connection, { confirmIsolatedCopy: true, hmacSecret: SECRET })).resolves.toMatchObject({
      status: "MATCH",
    });

    expect(record).toHaveBeenCalledTimes(2);
    expect(connection.commit).toHaveBeenCalledTimes(2);
  });

  it("rolls back observations and releases the lock if recording fails", async () => {
    const pairs: IdentityShadowSnapshotPair[] = [
      {
        observationType: "identity-shadow.system-profile.v1",
        sourceHighWaterMark: 1,
        legacyRows: [],
        targetRows: [],
      },
    ];
    const snapshots = { loadAll: vi.fn(async () => pairs) } as unknown as IdentityShadowSnapshotRepository;
    const observations = {
      loadSourceMutationHighWaterMark: vi.fn(async () => 1),
      startBatch: vi.fn(async () => undefined),
      record: vi.fn(async () => {
        throw new Error("synthetic observation failure");
      }),
      completeBatch: vi.fn(async () => undefined),
    } as unknown as IdentityShadowObservationRepository;
    const verifier = new IdentityShadowVerifier(snapshots, observations);
    const connection = fakeConnection();

    await expect(verifier.run(connection, { confirmIsolatedCopy: true, hmacSecret: SECRET })).rejects.toThrow(
      "synthetic observation failure",
    );
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.execute).toHaveBeenLastCalledWith("SELECT RELEASE_LOCK(?) AS released", [
      "examcheck_identity_shadow_verify_v1",
    ]);
  });

  it("preserves the original, rollback, and release failures together", async () => {
    const pairs: IdentityShadowSnapshotPair[] = [
      {
        observationType: "identity-shadow.system-profile.v1",
        sourceHighWaterMark: 1,
        legacyRows: [],
        targetRows: [],
      },
    ];
    const snapshots = { loadAll: vi.fn(async () => pairs) } as unknown as IdentityShadowSnapshotRepository;
    const observations = {
      loadSourceMutationHighWaterMark: vi.fn(async () => 1),
      startBatch: vi.fn(async () => undefined),
      record: vi.fn(async () => {
        throw new Error("primary comparison persistence failure");
      }),
      completeBatch: vi.fn(async () => undefined),
    } as unknown as IdentityShadowObservationRepository;
    const connection = fakeConnection();
    connection.rollback.mockRejectedValueOnce(new Error("rollback failure"));
    connection.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }], []];
      throw new Error("release failure");
    });

    const failure = await new IdentityShadowVerifier(snapshots, observations)
      .run(connection, { confirmIsolatedCopy: true, hmacSecret: SECRET })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map((error) => (error as Error).message)).toEqual([
      "primary comparison persistence failure",
      "rollback failure",
      "release failure",
    ]);
  });

  it("releases the acquired lock when consistent-snapshot startup fails before a transaction begins", async () => {
    const { verifier } = fixture([]);
    const connection = fakeConnection();
    connection.query.mockImplementation(async (sql: string) => {
      if (sql.includes("DATABASE()")) return [[{ databaseName: "examcheck_test_shadow" }], []];
      if (sql.includes("START TRANSACTION")) throw new Error("snapshot startup failure");
      return [[], []];
    });

    await expect(verifier.run(connection, { confirmIsolatedCopy: true, hmacSecret: SECRET })).rejects.toThrow(
      "snapshot startup failure",
    );
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.execute).toHaveBeenLastCalledWith("SELECT RELEASE_LOCK(?) AS released", [
      "examcheck_identity_shadow_verify_v1",
    ]);
  });
});

function fixture(pairs: readonly IdentityShadowSnapshotPair[]): {
  verifier: IdentityShadowVerifier;
  record: ReturnType<typeof vi.fn>;
} {
  const snapshots = { loadAll: vi.fn(async () => pairs) } as unknown as IdentityShadowSnapshotRepository;
  const record = vi.fn(async () => undefined);
  const observations = {
    loadSourceMutationHighWaterMark: vi.fn(async () => Math.max(0, ...pairs.map((pair) => pair.sourceHighWaterMark))),
    startBatch: vi.fn(async () => undefined),
    record,
    completeBatch: vi.fn(async () => undefined),
  } as unknown as IdentityShadowObservationRepository;
  return { verifier: new IdentityShadowVerifier(snapshots, observations), record };
}

function fakeConnection(): IdentityShadowVerificationConnection & {
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("DATABASE()")) return [[{ databaseName: "examcheck_test_shadow" }], []];
    return [[], []];
  });
  const execute = vi.fn(async (sql: string) => {
    if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }], []];
    if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }], []];
    return [[], []];
  });
  return {
    query,
    execute,
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
  } as unknown as ReturnType<typeof fakeConnection>;
}
