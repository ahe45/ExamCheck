import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { Pool } from "mysql2/promise";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { isDuplicateEntryError as isDuplicateEntry } from "../common/database/mysql-errors.js";
import { withTransaction } from "../common/database/transaction.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import type { CreateWorkstationDto } from "./workstations.dto.js";
import { WorkstationsRepository } from "./workstations.repository.js";

@Injectable()
export class WorkstationsService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(WorkstationsRepository) private readonly repository: WorkstationsRepository,
    @Inject(MutationAuditRepository) private readonly audit: MutationAuditRepository,
  ) {}

  async list() {
    return this.repository.list();
  }

  async create(input: CreateWorkstationDto, actorUserId: number) {
    try {
      return await withTransaction(this.pool, async (connection) => {
        const workstation = await this.repository.insert(connection, input);
        await this.audit.record(connection, {
          eventType: "WORKSTATION_CREATED",
          actorUserId,
          workstationId: workstation.id,
          details: { workstationId: workstation.id, code: workstation.code },
        });
        return workstation;
      });
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new ConflictException("이미 등록된 워크스테이션 코드입니다.");
      }
      throw error;
    }
  }
}
