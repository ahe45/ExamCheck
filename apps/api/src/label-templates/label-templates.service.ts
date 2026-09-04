import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Pool } from "mysql2/promise";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { isDuplicateEntryError } from "../common/database/mysql-errors.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import { renderLabelPayload } from "./label-payload-renderer.js";
import type {
  SaveLabelTemplateDto,
  UpdateLabelTemplateActiveDto,
  UpdateLabelTemplateMetadataDto,
} from "./label-templates.dto.js";
import { buildLabelZpl, labelTemplateSampleValues, LABEL_DATA_TAG_CATALOG } from "./label-template-layout.js";
import { LabelTemplatesRepository } from "./label-templates.repository.js";

@Injectable()
export class LabelTemplatesService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(LabelTemplatesRepository) private readonly repository: LabelTemplatesRepository,
    @Inject(MutationAuditRepository) private readonly audit: MutationAuditRepository,
  ) {}

  async list(activeOnly = false) {
    return {
      dataTags: LABEL_DATA_TAG_CATALOG,
      templates: await this.repository.list(this.pool, activeOnly),
    };
  }

  async preview(layoutValue: unknown) {
    const { layout, zplTemplate } = buildLabelZpl(layoutValue);
    return {
      layout,
      zplTemplate,
      samplePayload: await renderLabelPayload(layout, labelTemplateSampleValues(layout.sampleData)),
    };
  }

  async save(input: SaveLabelTemplateDto, user: AuthenticatedUser) {
    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();
    if (!name) throw new BadRequestException("라벨 양식명을 입력해 주세요.");
    const { layout, zplTemplate } = buildLabelZpl(input.layout);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const existing = await this.repository.findForUpdate(connection, code);
      let templateId: number;
      if (existing) {
        templateId = Number(existing.id);
        await this.repository.update(connection, templateId, {
          name,
          description: input.description,
          layout,
          zplTemplate,
          active: input.active !== false,
        });
      } else {
        templateId = await this.repository.insert(connection, {
          code,
          name,
          description: input.description,
          layout,
          zplTemplate,
          active: input.active !== false,
          createdBy: user.id,
        });
      }
      await this.audit.record(connection, {
        eventType: "LABEL_TEMPLATE_SAVED",
        actorUserId: user.id,
        details: { code, templateId, active: input.active !== false },
      });
      await connection.commit();
      return this.find(code);
    } catch (error) {
      await connection.rollback();
      if (isDuplicateEntryError(error)) throw new ConflictException("동일한 라벨 양식 코드가 이미 존재합니다.");
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateMetadata(codeValue: string, input: UpdateLabelTemplateMetadataDto, user: AuthenticatedUser) {
    return this.updateExisting(codeValue, user, "LABEL_TEMPLATE_METADATA_UPDATED", async (connection, id) => {
      await this.repository.updateMetadata(connection, id, input);
    });
  }

  async updateActive(codeValue: string, input: UpdateLabelTemplateActiveDto, user: AuthenticatedUser) {
    return this.updateExisting(codeValue, user, "LABEL_TEMPLATE_AVAILABILITY_UPDATED", async (connection, id) => {
      if (!input.active) await this.repository.clearSettingAssignments(connection, id);
      await this.repository.updateActive(connection, id, input.active);
    });
  }

  async remove(codeValue: string, user: AuthenticatedUser): Promise<void> {
    const code = codeValue.trim().toUpperCase();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const template = await this.repository.findForUpdate(connection, code);
      if (!template) throw new NotFoundException("삭제할 라벨 양식을 찾을 수 없습니다.");
      await this.repository.delete(connection, Number(template.id));
      await this.audit.record(connection, {
        eventType: "LABEL_TEMPLATE_DELETED",
        actorUserId: user.id,
        details: { code, templateId: Number(template.id) },
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async updateExisting(
    codeValue: string,
    user: AuthenticatedUser,
    eventType: "LABEL_TEMPLATE_METADATA_UPDATED" | "LABEL_TEMPLATE_AVAILABILITY_UPDATED",
    update: (connection: import("mysql2/promise").PoolConnection, id: number) => Promise<void>,
  ) {
    const code = codeValue.trim().toUpperCase();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const template = await this.repository.findForUpdate(connection, code);
      if (!template) throw new NotFoundException("수정할 라벨 양식을 찾을 수 없습니다.");
      await update(connection, Number(template.id));
      await this.audit.record(connection, {
        eventType,
        actorUserId: user.id,
        details: { code, templateId: Number(template.id) },
      });
      await connection.commit();
      return this.find(code);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async find(code: string) {
    const template = (await this.repository.list(this.pool)).find((item) => item.code === code);
    if (!template) throw new NotFoundException("저장한 라벨 양식을 불러오지 못했습니다.");
    return template;
  }
}
