import { Injectable } from "@nestjs/common";
import type { SqlExecutor } from "../database/sql-executor.js";
import { getCurrentRequestId } from "../http/request-context.js";
import { type MutationAuditRecord, normalizeMutationAuditRecord } from "./mutation-audit.contract.js";

export type {
  MutationAuditDetailsByEvent,
  MutationAuditEventType,
  MutationAuditRecord,
} from "./mutation-audit.contract.js";

@Injectable()
export class MutationAuditRepository {
  async record(executor: SqlExecutor, record: MutationAuditRecord): Promise<void> {
    const normalized = normalizeMutationAuditRecord(record, getCurrentRequestId());
    await executor.execute(
      `INSERT INTO audit_log
        (event_type, actor_user_id, workstation_id, print_job_id, request_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        normalized.eventType,
        normalized.actorUserId,
        normalized.workstationId,
        normalized.printJobId,
        normalized.requestId,
        JSON.stringify(normalized.details),
      ],
    );
  }
}
