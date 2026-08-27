import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import type { Pool, PoolConnection } from "mysql2/promise";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { MutationAuditRepository } from "../common/audit/mutation-audit.repository.js";
import { isDuplicateEntryError as isDuplicateEntry } from "../common/database/mysql-errors.js";
import { withTransaction } from "../common/database/transaction.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import type { PseudonymNoUniqueness } from "../uniqueness/number-uniqueness.js";
import type { ChangeDeveloperPasswordDto, UpdateDeveloperSettingsDto } from "./developer-settings.dto.js";
import { DeveloperSettingsRepository, type ProfileRow } from "./developer-settings.repository.js";
interface LogoFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

type LogoMimeType = "image/png" | "image/jpeg" | "image/webp";
const logoMimeTypes = new Set<LogoMimeType>(["image/png", "image/jpeg", "image/webp"]);

@Injectable()
export class DeveloperSettingsService {
  private readonly repository: DeveloperSettingsRepository;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(MutationAuditRepository) private readonly audit: MutationAuditRepository,
    @Optional() @Inject(DeveloperSettingsRepository) repository?: DeveloperSettingsRepository,
  ) {
    this.repository = repository ?? new DeveloperSettingsRepository(pool);
  }

  async get() {
    const profile = await this.repository.getProfile();
    if (!profile) throw new NotFoundException("시스템 기본 설정을 찾을 수 없습니다.");
    return profileResponse(profile);
  }

  async update(input: UpdateDeveloperSettingsDto, user: AuthenticatedUser) {
    try {
      await withTransaction(this.pool, async (connection) => {
        const profile = await this.lockProfile(connection);
        const examineeNoUniqueness = input.examineeNoUniqueness ?? profile.examineeNoUniqueness;
        const pseudonymNoUniqueness = input.pseudonymNoUniqueness ?? profile.pseudonymNoUniqueness;

        if (profile.examineeNoUniqueness !== examineeNoUniqueness && examineeNoUniqueness === "SYSTEM") {
          await this.assertNoSystemExamineeNumberConflicts(connection);
        }
        if (examineeNoUniqueness === "SCHEDULE") {
          await this.assertNoScheduleIdentityConflicts(connection);
        }
        if (profile.pseudonymNoUniqueness !== pseudonymNoUniqueness) {
          await this.applyPseudonymNumberPolicy(connection, pseudonymNoUniqueness);
        }

        await this.repository.updateProfile(connection, {
          schoolName: input.schoolName.trim(),
          academicYear: input.academicYear,
          systemName: input.systemName.trim(),
          examineeNoUniqueness,
          pseudonymNoUniqueness,
          updatedBy: user.id,
        });
        await this.audit.record(connection, {
          eventType: "SYSTEM_PROFILE_UPDATED",
          actorUserId: user.id,
          details: {
            schoolName: input.schoolName.trim(),
            academicYear: input.academicYear,
            systemName: input.systemName.trim(),
            examineeNoUniqueness,
            pseudonymNoUniqueness,
          },
        });
      });
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new ConflictException("가번호 유일 정책을 변경할 수 없습니다. 중복된 가번호가 존재합니다.");
      }
      throw error;
    }

    // The mutation and audit are already committed here. A subsequent read failure is
    // intentionally returned as a response failure and must not roll back the committed change.
    return this.get();
  }

  async uploadLogo(file: LogoFile | undefined, user: AuthenticatedUser) {
    if (!file) throw new BadRequestException("업로드할 로고 이미지 파일을 선택해 주세요.");
    if (!isLogoMimeType(file.mimetype)) {
      throw new BadRequestException("로고는 PNG, JPG, WEBP 형식만 사용할 수 있습니다.");
    }
    const mimeType = file.mimetype;
    if (!file.buffer.length || file.buffer.length > 2 * 1024 * 1024 || file.size > 2 * 1024 * 1024)
      throw new BadRequestException("로고 파일은 2MB 이하여야 합니다.");
    if (!hasImageSignature(file.buffer, mimeType)) {
      throw new BadRequestException("로고 파일의 실제 이미지 형식이 확장자와 일치하지 않습니다.");
    }
    if (!hasMatchingImageExtension(file.originalname, mimeType)) {
      throw new BadRequestException("로고 파일의 확장자와 이미지 형식이 일치하지 않습니다.");
    }
    await withTransaction(this.pool, async (connection) => {
      await this.lockProfile(connection);
      await this.repository.updateLogo(connection, {
        fileName: file.originalname,
        mimeType,
        data: file.buffer,
        updatedBy: user.id,
      });
      await this.audit.record(connection, {
        eventType: "SYSTEM_LOGO_UPDATED",
        actorUserId: user.id,
        details: {
          fileName: file.originalname,
          mimeType,
        },
      });
    });
    return this.get();
  }

  async removeLogo(user: AuthenticatedUser) {
    await withTransaction(this.pool, async (connection) => {
      await this.lockProfile(connection);
      await this.repository.removeLogo(connection, user.id);
      await this.audit.record(connection, {
        eventType: "SYSTEM_LOGO_REMOVED",
        actorUserId: user.id,
        details: {},
      });
    });
    return this.get();
  }

  async changePassword(input: ChangeDeveloperPasswordDto, user: AuthenticatedUser) {
    const newPasswordHash = await hashPassword(input.newPassword);
    await withTransaction(this.pool, async (connection) => {
      const developer = await this.repository.findDeveloperForUpdate(connection, user.id);
      if (!developer) throw new NotFoundException("개발자 계정을 찾을 수 없습니다.");
      if (!developer.passwordHash || !(await verifyPassword(input.currentPassword, developer.passwordHash))) {
        throw new UnauthorizedException("현재 비밀번호가 올바르지 않습니다.");
      }
      await this.repository.updateDeveloperPassword(connection, developer.id, newPasswordHash);
      await this.audit.record(connection, {
        eventType: "DEVELOPER_PASSWORD_CHANGED",
        actorUserId: user.id,
        details: { developerUserId: developer.id },
      });
    });
    return { changed: true };
  }

  private async lockProfile(connection: PoolConnection) {
    const profile = await this.repository.lockProfile(connection);
    if (!profile) throw new NotFoundException("시스템 기본 설정을 찾을 수 없습니다.");
    return profile;
  }

  private async assertNoSystemExamineeNumberConflicts(connection: PoolConnection) {
    const conflictCount = await this.repository.countSystemExamineeNumberConflicts(connection);
    if (conflictCount > 0) {
      throw new ConflictException(
        `수험번호 유일 정책을 시스템 전체로 변경할 수 없습니다. 중복된 수험번호가 ${conflictCount}개 있습니다.`,
      );
    }
  }

  private async assertNoScheduleIdentityConflicts(connection: PoolConnection) {
    const conflictCount = await this.repository.countScheduleIdentityConflicts(connection);
    if (conflictCount > 0) {
      throw new ConflictException(
        `수험번호 유일 정책을 교시별로 변경할 수 없습니다. 같은 수험번호에 서로 다른 인적 정보가 ${conflictCount}개 있습니다.`,
      );
    }
  }

  private async applyPseudonymNumberPolicy(connection: PoolConnection, policy: PseudonymNoUniqueness) {
    if (policy === "ADMISSION") {
      const conflictCount = await this.repository.countAdmissionPseudonymConflicts(connection);
      if (conflictCount > 0) {
        throw new ConflictException(
          `가번호 유일 정책을 전형 전체로 변경할 수 없습니다. 중복된 가번호 조합이 ${conflictCount}개 있습니다.`,
        );
      }
      await this.repository.resetPseudonymScope(connection);
      return;
    }

    await this.repository.rebuildPseudonymScheduleScope(connection);
  }
}

function isLogoMimeType(value: string): value is LogoMimeType {
  return logoMimeTypes.has(value as LogoMimeType);
}

function hasImageSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "image/png") {
    return (
      buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return (
      buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP"
    );
  }
  return false;
}

function hasMatchingImageExtension(fileName: string, mimeType: string): boolean {
  const extension =
    fileName
      .trim()
      .toLowerCase()
      .match(/\.([^.]+)$/)?.[1] ?? "";
  if (mimeType === "image/png") return extension === "png";
  if (mimeType === "image/jpeg") return extension === "jpg" || extension === "jpeg";
  if (mimeType === "image/webp") return extension === "webp";
  return false;
}

function profileResponse(profile: ProfileRow) {
  return {
    schoolName: profile.schoolName,
    academicYear: Number(profile.academicYear),
    systemName: profile.systemName,
    examineeNoUniqueness: profile.examineeNoUniqueness,
    pseudonymNoUniqueness: profile.pseudonymNoUniqueness,
    logoFileName: profile.logoFileName,
    logoDataUrl:
      profile.logoData && profile.logoMimeType
        ? `data:${profile.logoMimeType};base64,${profile.logoData.toString("base64")}`
        : null,
    updatedAt: profile.updatedAt,
  };
}
