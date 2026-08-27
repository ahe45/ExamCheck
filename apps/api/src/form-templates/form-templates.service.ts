import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { Pool } from "mysql2/promise";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { isDuplicateEntryError as isDuplicateEntry } from "../common/database/mysql-errors.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import type { SaveFormTemplateDto, UpdateFormTemplateMetadataDto } from "./form-templates.dto.js";
import { scanFormTemplateSecurityRisks, summarizeFormTemplateSecurityRisks } from "./form-template-security.js";
import { formTemplateDataTags } from "./form-template-tags.js";
import { FormTemplatesRepository } from "./form-templates.repository.js";

@Injectable()
export class FormTemplatesService {
  private readonly repository: FormTemplatesRepository;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(MutationAuditRepository)
    private readonly audit: MutationAuditRepository = new MutationAuditRepository(),
    @Optional() @Inject(FormTemplatesRepository) repository?: FormTemplatesRepository,
  ) {
    this.repository = repository ?? new FormTemplatesRepository(pool);
  }

  getDataTags() {
    return formTemplateDataTags;
  }

  async listLatest(activeOnly: boolean) {
    return this.repository.listLatest(activeOnly);
  }

  async findActive(code: string) {
    const template = await this.repository.findActive(code.trim().toUpperCase());
    if (!template) throw new NotFoundException("사용 가능한 양식 템플릿을 찾을 수 없습니다.");
    return template;
  }

  async save(input: SaveFormTemplateDto, user: AuthenticatedUser) {
    const code = input.code.trim().toUpperCase();
    const securityRiskSummary = summarizeFormTemplateSecurityRisks(scanFormTemplateSecurityRisks(input.layout));
    if (securityRiskSummary.riskCount > 0) {
      throw new BadRequestException(
        `실행 가능한 코드나 위험한 URL이 포함된 양식은 저장할 수 없습니다. 위험 요소 ${securityRiskSummary.riskCount}개를 제거해 주세요.`,
      );
    }
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const nextVersion = await this.repository.nextVersionForUpdate(connection, code);
      if (nextVersion > 1) {
        await this.repository.deactivateActiveVersions(connection, code);
      }
      await this.repository.insert(connection, input, code, nextVersion, user.id);
      await this.audit.record(connection, {
        eventType: "FORM_TEMPLATE_SAVED",
        actorUserId: user.id,
        details: {
          code,
          version: nextVersion,
          active: input.active !== false,
          riskCount: securityRiskSummary.riskCount,
        },
      });
      await connection.commit();
      return this.findActive(code).catch(async (error) => {
        if (input.active === false) {
          const templates = await this.listLatest(false);
          const saved = templates.find((template) => template.code === code);
          if (saved) return saved;
        }
        throw error;
      });
    } catch (error) {
      await connection.rollback();
      if (isDuplicateEntry(error)) throw new ConflictException("동일한 양식 버전이 이미 존재합니다.");
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateMetadata(codeValue: string, input: UpdateFormTemplateMetadataDto, user: AuthenticatedUser) {
    const code = codeValue.trim().toUpperCase();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const templateId = await this.repository.findLatestIdForUpdate(connection, code);
      if (!templateId) throw new NotFoundException("수정할 양식을 찾을 수 없습니다.");

      await this.repository.updateMetadata(connection, templateId, input);
      await this.audit.record(connection, {
        eventType: "FORM_TEMPLATE_METADATA_UPDATED",
        actorUserId: user.id,
        details: { code, templateId },
      });
      await connection.commit();
      const templates = await this.listLatest(false);
      const updated = templates.find((template) => template.code === code);
      if (!updated) throw new NotFoundException("수정한 양식을 불러오지 못했습니다.");
      return updated;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
