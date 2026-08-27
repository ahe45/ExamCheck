import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser } from "../auth/current-user.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { RequirePermissions } from "../auth/permissions.js";
import { RolesGuard } from "../auth/roles.js";
import {
  PHOTO_ARCHIVE_UPLOAD_MAX_BYTES,
  validatePhotoArchiveUploadFile,
  validateWorkbookUploadFile,
  WORKBOOK_UPLOAD_MAX_BYTES,
  type CandidateUploadFile,
} from "./candidate-upload-security.js";
import { CandidateDashboardQueryDto, CandidateImportQueryDto } from "./candidates.dto.js";
import { CandidatesService } from "./candidates.service.js";

export const CANDIDATE_PREVIEW_TOKEN_HEADER = "x-candidate-preview-token";

@Controller("candidates")
@UseGuards(AuthGuard, RolesGuard)
@RequirePermissions("candidate.import")
export class CandidatesController {
  constructor(@Inject(CandidatesService) private readonly candidatesService: CandidatesService) {}

  @Get("dashboard-summary")
  dashboardSummary(@Query() query: CandidateDashboardQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.candidatesService.dashboardSummary(user, query.admissionName);
  }

  @Get()
  list() {
    return this.candidatesService.list();
  }

  @Get("template.xlsx")
  async downloadTemplate() {
    return new StreamableFile(await this.candidatesService.buildTemplate(), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent("수험생 업로드 양식.xlsx")}`,
    });
  }

  @Get("export.xlsx")
  async exportData() {
    return new StreamableFile(await this.candidatesService.buildExport(), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent("수험생 데이터.xlsx")}`,
    });
  }

  @Post("import/preview")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: WORKBOOK_UPLOAD_MAX_BYTES } }))
  preview(@UploadedFile() uploadedFile: CandidateUploadFile | undefined, @CurrentUser() user: AuthenticatedUser) {
    const file = validateWorkbookUploadFile(uploadedFile);
    return this.candidatesService.preview(file.buffer, file.originalname, user.id);
  }

  @Post("import")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: WORKBOOK_UPLOAD_MAX_BYTES } }))
  import(
    @UploadedFile() uploadedFile: CandidateUploadFile | undefined,
    @Query() query: CandidateImportQueryDto,
    @Headers(CANDIDATE_PREVIEW_TOKEN_HEADER) previewToken: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const file = validateWorkbookUploadFile(uploadedFile);
    return this.candidatesService.import(
      file.buffer,
      query.policy ?? "insert-update",
      validateCandidatePreviewTokenHeader(previewToken),
      user.id,
    );
  }

  @Post("photo-archive/preview")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: PHOTO_ARCHIVE_UPLOAD_MAX_BYTES } }))
  previewPhotoArchive(
    @UploadedFile() uploadedFile: CandidateUploadFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const file = validatePhotoArchiveUploadFile(uploadedFile);
    return this.candidatesService.previewPhotoArchive(file.buffer, file.originalname, user.id);
  }

  @Post("photo-archive")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: PHOTO_ARCHIVE_UPLOAD_MAX_BYTES } }))
  importPhotoArchive(
    @UploadedFile() uploadedFile: CandidateUploadFile | undefined,
    @Query() query: CandidateImportQueryDto,
    @Headers(CANDIDATE_PREVIEW_TOKEN_HEADER) previewToken: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const file = validatePhotoArchiveUploadFile(uploadedFile);
    return this.candidatesService.importPhotoArchive(
      file.buffer,
      query.policy ?? "insert-update",
      validateCandidatePreviewTokenHeader(previewToken),
      user.id,
    );
  }
}

export function validateCandidatePreviewTokenHeader(value: string | undefined): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048 || value.trim() !== value) {
    throw new BadRequestException("수험생 데이터 미리보기 토큰을 확인해 주세요.");
  }
  return value;
}
