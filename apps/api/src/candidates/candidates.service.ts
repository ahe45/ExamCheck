import { parseCandidateWorkbook } from "./candidate-workbook-parser.js";
import { beginReadSnapshot } from "../common/database/transaction.js";
import { finished } from "node:stream/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { Pool } from "mysql2/promise";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import {
  ADMISSION_SQL_COLUMNS,
  assertAdmissionAccess,
  buildAdmissionAccessPredicate,
} from "../authorization/admission-policy.js";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { DATABASE_POOL } from "../database/database.constants.js";
import {
  assertCandidateNumberUniqueness,
  assertCandidateUploadPolicy,
  buildCandidatePreview,
  matchCandidatePhotos,
  type CandidatePhotoArchiveFiles,
  type CandidateUploadPolicy,
} from "./candidate-domain.js";
import { candidateFieldKeys, candidateFields } from "./candidate-fields.js";
import { toCandidateHttpError } from "./candidate-http-errors.js";
import {
  candidatePhotoStateChecksum,
  candidateWorkbookStateChecksum,
  createCandidatePreviewTicket,
  verifyCandidatePreviewTicket,
} from "./candidate-preview-ticket.js";
import { openValidatedPhotoArchive, readValidatedPhotoEntry } from "./candidate-upload-security.js";
import { CandidatesApplicationService } from "./candidates.application.js";
import { CandidatesRepository } from "./candidates.repository.js";
import { parseCandidateListQuery } from "./candidate-list-query.js";

export { assertCandidateNumberUniqueness, validateCandidateWorkbookHeaders } from "./candidate-domain.js";
export type { CandidateRecordRow } from "./candidates.repository.js";

@Injectable()
export class CandidatesService {
  private readonly previewSecret: string;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(CandidatesRepository) private readonly repository: CandidatesRepository,
    @Inject(CandidatesApplicationService) private readonly application: CandidatesApplicationService,
    @Inject(APP_CONFIG) config: Readonly<AppConfig>,
  ) {
    this.previewSecret = config.auth.jwtSecret;
  }

  list() {
    return this.repository.list(this.pool);
  }

  listPage(raw?: string) {
    return this.repository.listPage(this.pool, parseCandidateListQuery(raw));
  }
  filterValues(field: string) {
    return this.repository.filterValues(this.pool, field);
  }

  async dashboardSummary(user: AuthenticatedUser, requestedAdmissionName?: string) {
    const admissionName = requestedAdmissionName
      ? assertAdmissionAccess(user, requestedAdmissionName, {
          forbiddenMessage: "배정되지 않은 전형의 대시보드는 조회할 수 없습니다.",
        })
      : undefined;
    const access = buildAdmissionAccessPredicate(user, ADMISSION_SQL_COLUMNS.candidateRecord);
    const rows = await this.repository.listDashboardBreakdownCounts(this.pool, access, admissionName);
    const breakdowns = {
      admission: toDashboardStatistics(rows.filter((row) => row.groupType === "admission")),
      building: toDashboardStatistics(rows.filter((row) => row.groupType === "building")),
      period: toDashboardStatistics(rows.filter((row) => row.groupType === "period")),
      waitingRoom: toDashboardStatistics(rows.filter((row) => row.groupType === "waitingRoom")),
    };
    const admissions = breakdowns.admission;
    const totalCandidates = admissions.reduce((sum, admission) => sum + admission.total, 0);
    const assignedCandidates = admissions.reduce((sum, admission) => sum + admission.assigned, 0);
    const admissionCounts = admissions.reduce(
      (counts, admission) => {
        counts[admission.status] += 1;
        return counts;
      },
      { waiting: 0, progress: 0, complete: 0 },
    );
    return {
      totalCandidates,
      assignedCandidates,
      unassignedCandidates: totalCandidates - assignedCandidates,
      assignmentRate: percentage(assignedCandidates, totalCandidates),
      admissions,
      admissionCounts,
      breakdowns,
    };
  }

  async preview(buffer: Buffer, fileName: string, actorUserId: number) {
    try {
      const candidates = await parseCandidateWorkbook(buffer);
      const uniqueness = await this.repository.loadExamineeNumberUniqueness(this.pool, { forUpdate: false });
      const existing = await this.repository.loadExisting(this.pool, {
        forUpdate: false,
        examineeNos: [...new Set(candidates.map((row) => row.examineeNo))],
      });
      assertCandidateNumberUniqueness(candidates, existing, uniqueness);
      const previewToken = createCandidatePreviewTicket(
        {
          version: 1,
          kind: "WORKBOOK",
          actorUserId,
          fileChecksum: checksum(buffer),
          stateChecksum: candidateWorkbookStateChecksum(existing.values(), this.previewSecret, uniqueness),
          expiresAt: Date.now() + PREVIEW_TICKET_TTL_MS,
        },
        this.previewSecret,
      );
      return { fileName, previewToken, ...buildCandidatePreview(candidates, existing) };
    } catch (error) {
      throw toCandidateHttpError(error);
    }
  }

  async import(buffer: Buffer, policy: CandidateUploadPolicy, previewToken: string, actorUserId: number) {
    try {
      assertCandidateUploadPolicy(policy, "workbook");
      const fileChecksum = checksum(buffer);
      const ticket = verifyCandidatePreviewTicket(
        previewToken,
        { kind: "WORKBOOK", actorUserId, fileChecksum },
        this.previewSecret,
      );
      const candidates = await parseCandidateWorkbook(buffer);
      return await this.application.importCandidates(
        candidates,
        policy,
        fileChecksum,
        actorUserId,
        ticket.stateChecksum,
      );
    } catch (error) {
      throw toCandidateHttpError(error);
    }
  }

  async previewPhotoArchive(buffer: Buffer, fileName: string, actorUserId: number) {
    try {
      const archive = this.parsePhotoArchive(buffer);
      const candidateRows = await this.repository.listCandidatePhotos(this.pool, { forUpdate: false });
      const parsed = matchCandidatePhotos(archive, candidateRows);
      const previewToken = createCandidatePreviewTicket(
        {
          version: 1,
          kind: "PHOTO_ARCHIVE",
          actorUserId,
          fileChecksum: checksum(buffer),
          stateChecksum: candidatePhotoStateChecksum(
            parsed.photos.flatMap((photo) => photo.candidateRows),
            this.previewSecret,
          ),
          expiresAt: Date.now() + PREVIEW_TICKET_TTL_MS,
        },
        this.previewSecret,
      );
      return {
        fileName,
        previewToken,
        totalFiles: parsed.totalFiles,
        matchedCount: parsed.photos.length,
        skippedCount: parsed.skippedCount,
        duplicateCount: parsed.duplicateCount,
      };
    } catch (error) {
      throw toCandidateHttpError(error);
    }
  }

  async importPhotoArchive(buffer: Buffer, policy: CandidateUploadPolicy, previewToken: string, actorUserId: number) {
    try {
      assertCandidateUploadPolicy(policy, "photo");
      const fileChecksum = checksum(buffer);
      const ticket = verifyCandidatePreviewTicket(
        previewToken,
        { kind: "PHOTO_ARCHIVE", actorUserId, fileChecksum },
        this.previewSecret,
      );
      const archive = this.parsePhotoArchive(buffer);
      return await this.application.importCandidatePhotos(
        archive,
        policy,
        fileChecksum,
        actorUserId,
        ticket.stateChecksum,
      );
    } catch (error) {
      throw toCandidateHttpError(error);
    }
  }

  async buildTemplate() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("수험생등록_양식", { views: [{ state: "frozen", ySplit: 1 }] });
    worksheet.columns = candidateFields.map((field) => ({ header: field.label, key: field.key, width: field.width }));
    worksheet.getRow(1).font = { name: "맑은 고딕", size: 11, color: { argb: "FF000000" } };
    worksheet.getRow(1).height = 21;
    candidateFields.forEach((field, index) => {
      const cell = worksheet.getRow(1).getCell(index + 1);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: field.optional ? "FFE2F0D9" : "FFFFFF00" },
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin", color: { argb: "FFB7B7B7" } },
        left: { style: "thin", color: { argb: "FFB7B7B7" } },
        bottom: { style: "thin", color: { argb: "FFB7B7B7" } },
        right: { style: "thin", color: { argb: "FFB7B7B7" } },
      };
      if (field.format === "date") cell.note = "yyyy-mm-dd 형식으로 입력하세요. 예: 2026-03-28";
      if (field.format === "time") {
        cell.note = field.optional
          ? "선택 입력입니다. 입력 시 hh:mm 형식으로 입력하세요. 예: 10:00"
          : "hh:mm 형식으로 입력하세요. 예: 08:40";
      }
    });
    worksheet.addRow(Object.fromEntries(candidateFields.map((field) => [field.key, field.sample])));
    worksheet.getRow(2).font = { name: "맑은 고딕", size: 10 };
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async streamExport(raw?: string) {
    const directory = await mkdtemp(join(tmpdir(), "examcheck-export-"));
    const path = join(directory, "candidates.xlsx");
    try {
      await this.writeExportFile(raw, path);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    const stream = createReadStream(path);
    stream.once("close", () => {
      void rm(directory, { recursive: true, force: true }).catch(() => {});
    });
    return stream;
  }

  async writeExportFile(raw: string | undefined, path: string, progress?: (count: number) => Promise<void>) {
    const query = parseCandidateListQuery(raw);
    const connection = await this.pool.getConnection();
    const output = createWriteStream(path);
    let outputError: Error | undefined;
    output.on("error", (error) => {
      outputError = error;
    });
    try {
      await beginReadSnapshot(connection);
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: output,
        useStyles: true,
        useSharedStrings: false,
      });
      const worksheet = workbook.addWorksheet("수험생등록", { views: [{ state: "frozen", ySplit: 1 }] });
      worksheet.columns = candidateFields.map((field) => ({
        header: field.label,
        key: field.key,
        width: field.width,
        style: { numFmt: "@" },
      }));
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).commit();
      let offset = 0;
      for (;;) {
        if (outputError) throw outputError;
        const rows = await this.repository.exportBatch(connection, query, offset);
        for (const row of rows)
          worksheet.addRow(Object.fromEntries(candidateFieldKeys.map((key) => [key, row[key] || ""]))).commit();
        offset += rows.length;
        await progress?.(offset);
        if (rows.length < 500) break;
      }
      worksheet.commit();
      await workbook.commit();
      if (outputError) throw outputError;
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      output.destroy();
      await finished(output).catch(() => {});
      connection.release();
    }
  }

  async buildExport() {
    const rows = await this.list();
    if (!rows.length) throw new BadRequestException("다운로드할 수험생 데이터가 없습니다.");
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("수험생등록", { views: [{ state: "frozen", ySplit: 1 }] });
    worksheet.columns = candidateFields.map((field) => ({
      header: field.label,
      key: field.key,
      width: field.width,
      style: { numFmt: "@" },
    }));
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7FB" } };
    rows.forEach((row) => worksheet.addRow(Object.fromEntries(candidateFieldKeys.map((key) => [key, row[key] || ""]))));
    for (let row = 1; row <= worksheet.rowCount; row += 1) {
      for (let column = 1; column <= candidateFields.length; column += 1) {
        worksheet.getRow(row).getCell(column).numFmt = "@";
      }
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private parsePhotoArchive(buffer: Buffer): CandidatePhotoArchiveFiles {
    const entries = openValidatedPhotoArchive(buffer);
    const files: CandidatePhotoArchiveFiles["files"] = [];
    let totalFiles = 0;
    let skippedCount = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      totalFiles += 1;
      const fileName = entry.entryName.replace(/\\/g, "/").split("/").pop() || entry.entryName;
      const extension = fileName.split(".").pop()?.toLowerCase() || "";
      if (!["jpg", "jpeg", "png"].includes(extension)) {
        skippedCount += 1;
        continue;
      }
      const validatedPhoto = readValidatedPhotoEntry(entry, extension);
      if (!validatedPhoto) {
        skippedCount += 1;
        continue;
      }
      files.push({
        fileName,
        mimeType: validatedPhoto.mimeType,
        content: validatedPhoto.content,
        contentHash: checksum(validatedPhoto.content),
      });
    }
    if (!totalFiles) throw new BadRequestException("ZIP 파일에 사진 파일이 없습니다.");
    return { files, totalFiles, skippedCount };
  }
}

const PREVIEW_TICKET_TTL_MS = 30 * 60 * 1000;

function checksum(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function percentage(value: number, total: number) {
  return total ? Math.round((value / total) * 1000) / 10 : 0;
}

function toDashboardStatistics(rows: readonly { name: string; total: number; assigned: number }[]) {
  return rows
    .map((row) => {
      const total = Number(row.total);
      const assigned = Number(row.assigned);
      const status = assigned === 0 ? "waiting" : assigned === total ? "complete" : "progress";
      return {
        name: row.name,
        total,
        assigned,
        unassigned: total - assigned,
        assignmentRate: percentage(assigned, total),
        status,
      } as const;
    })
    .sort((left, right) => left.name.localeCompare(right.name, "ko"));
}
