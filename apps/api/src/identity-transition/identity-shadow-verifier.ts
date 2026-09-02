import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { SqlExecutor } from "../common/database/sql-executor.js";
import { compareIdentityProjections } from "./identity-shadow.js";
import { IdentityShadowObservationRepository } from "./identity-shadow-observation.repository.js";
import {
  IDENTITY_SHADOW_OBSERVATION_TYPES,
  IdentityShadowSnapshotRepository,
  type IdentityShadowObservationType,
} from "./identity-shadow-snapshot.repository.js";

export const IDENTITY_SHADOW_VERIFY_ADVISORY_LOCK = "examcheck_identity_shadow_verify_v1";

export interface IdentityShadowVerificationConnection extends SqlExecutor {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface IdentityShadowVerificationOptions {
  confirmIsolatedCopy: boolean;
  hmacSecret: string;
}

export interface IdentityShadowVerificationSummary {
  observationType: IdentityShadowObservationType;
  sourceHighWaterMark: number;
  oldRowCount: number;
  newRowCount: number;
  counts: {
    match: number;
    mismatch: number;
    oldOnly: number;
    newOnly: number;
    ambiguous: number;
  };
  matches: boolean;
}

export interface IdentityShadowVerificationReport {
  status: "MATCH" | "MISMATCH";
  observations: readonly IdentityShadowVerificationSummary[];
}

export class IdentityShadowVerifier {
  constructor(
    private readonly snapshots = new IdentityShadowSnapshotRepository(),
    private readonly observations = new IdentityShadowObservationRepository(),
  ) {}

  async run(
    connection: IdentityShadowVerificationConnection,
    options: IdentityShadowVerificationOptions,
  ): Promise<IdentityShadowVerificationReport> {
    const databaseName = await currentDatabaseName(connection);
    assertIsolatedShadowExecution(databaseName, options.confirmIsolatedCopy);
    assertHmacSecret(options.hmacSecret);
    await acquireVerificationLock(connection);

    let transactionStarted = false;
    let result: IdentityShadowVerificationReport | undefined;
    const failures: unknown[] = [];
    try {
      await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
      transactionStarted = true;

      // This is the shared commit boundary for every domain in the batch. The
      // allowlisted business mutation audit is written atomically with source writes.
      const sourceHighWaterMark = await this.observations.loadSourceMutationHighWaterMark(connection);
      // Load every pair before writing observations so all comparisons share the
      // same read view even though the transaction later becomes read-write.
      const pairs = await this.snapshots.loadAll(connection);
      const verificationBatchId = randomUUID();
      await this.observations.startBatch(connection, verificationBatchId);
      const summaries: IdentityShadowVerificationSummary[] = [];
      for (const snapshot of pairs) {
        const report = compareIdentityProjections(snapshot.legacyRows, snapshot.targetRows, options.hmacSecret);
        await this.observations.record(connection, {
          verificationBatchId,
          observationType: snapshot.observationType,
          sourceHighWaterMark,
          report,
        });
        summaries.push({
          observationType: snapshot.observationType,
          sourceHighWaterMark,
          oldRowCount: report.oldRowCount,
          newRowCount: report.newRowCount,
          counts: { ...report.counts },
          matches: allEntitiesMatch(report.counts),
        });
      }
      await this.observations.completeBatch(connection, verificationBatchId, IDENTITY_SHADOW_OBSERVATION_TYPES);
      await connection.commit();
      transactionStarted = false;
      result = {
        status: summaries.every((summary) => summary.matches) ? "MATCH" : "MISMATCH",
        observations: summaries,
      };
    } catch (error) {
      failures.push(error);
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          failures.push(rollbackError);
        }
      }
    }
    try {
      await releaseVerificationLock(connection);
    } catch (releaseError) {
      failures.push(releaseError);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "Identity shadow verification and cleanup both failed.", {
        cause: failures[0],
      });
    }
    if (!result) throw new Error("Identity shadow verification completed without a report.");
    return result;
  }
}

export function assertIsolatedShadowExecution(databaseName: string, confirmed: boolean): void {
  if (!confirmed) {
    throw new Error("Identity shadow verification is blocked until --confirm-isolated-copy is provided.");
  }
  if (!/(?:^|[_-])(it|test|shadow|sandbox|staging|refactor)(?:[_-]|$)/i.test(databaseName)) {
    throw new Error(
      "Identity shadow verification only accepts an explicitly named isolated database copy. " +
        "Operational databases must use the separately approved cutover verification procedure.",
    );
  }
}

function allEntitiesMatch(counts: IdentityShadowVerificationSummary["counts"]): boolean {
  return counts.mismatch === 0 && counts.oldOnly === 0 && counts.newOnly === 0 && counts.ambiguous === 0;
}

function assertHmacSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new TypeError("Identity shadow verification requires an HMAC secret of at least 32 bytes.");
  }
}

interface DatabaseRow extends RowDataPacket {
  databaseName: string | null;
}

interface LockRow extends RowDataPacket {
  acquired?: number;
  released?: number;
}

async function currentDatabaseName(connection: SqlExecutor): Promise<string> {
  const [rows] = await connection.query<DatabaseRow[]>("SELECT DATABASE() AS databaseName");
  const databaseName = rows[0]?.databaseName;
  if (!databaseName) throw new Error("Identity shadow verification requires an explicitly selected database.");
  return databaseName;
}

async function acquireVerificationLock(connection: SqlExecutor): Promise<void> {
  const [rows] = await connection.execute<LockRow[]>("SELECT GET_LOCK(?, 0) AS acquired", [
    IDENTITY_SHADOW_VERIFY_ADVISORY_LOCK,
  ]);
  if (Number(rows[0]?.acquired) !== 1) throw new Error("Another identity shadow verification is already running.");
}

async function releaseVerificationLock(connection: SqlExecutor): Promise<void> {
  const [rows] = await connection.execute<LockRow[]>("SELECT RELEASE_LOCK(?) AS released", [
    IDENTITY_SHADOW_VERIFY_ADVISORY_LOCK,
  ]);
  if (Number(rows[0]?.released) !== 1) {
    throw new Error("Identity shadow verification advisory lock was not released.");
  }
}
