import {
  CandidateUploadService,
  incomingUploadDirectory,
  type DiskCandidateUpload,
} from "./candidate-upload.service.js";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Patch,
  Put,
  ParseIntPipe,
  Param,
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
  WORKBOOK_UPLOAD_MAX_BYTES,
  PHOTO_ARCHIVE_MAX_ENTRY_BYTES,
  validateCandidatePhotoBuffer,
  normalizeMultipartFileName,
} from "./candidate-upload-security.js";
import { extname } from "node:path";
import {
  CandidateDashboardQueryDto,
  CandidateImportQueryDto,
  CandidateListQueryDto,
  CandidateFilterQueryDto,
  CandidateUpdateDto,
} from "./candidates.dto.js";
import { CandidatesService } from "./candidates.service.js";

export const CANDIDATE_PREVIEW_TOKEN_HEADER = "x-candidate-preview-token";

@Controller("candidates")
@UseGuards(AuthGuard, RolesGuard)
@RequirePermissions("candidate.import")
export class CandidatesController {
  constructor(
    @Inject(CandidatesService) private readonly candidatesService: CandidatesService,
    @Inject(CandidateUploadService) private readonly uploads: CandidateUploadService,
  ) {}

  @Get("dashboard-summary")
  dashboardSummary(@Query() query: CandidateDashboardQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.candidatesService.dashboardSummary(user, query.admissionName);
  }

  @Get("attendance")
  attendance(@CurrentUser() user: AuthenticatedUser) {
    return this.candidatesService.attendance(user);
  }

  @Get()
  list() {
    return this.candidatesService.list();
  }

  @Get("page")
  listPage(@Query() query: CandidateListQueryDto) {
    return this.candidatesService.listPage(query.query);
  }

  @Post("page")
  queryPage(@Body() query: CandidateListQueryDto) {
    return this.candidatesService.listPage(query.query);
  }

  @Get("filter-values")
  filterValues(@Query() query: CandidateFilterQueryDto) {
    return this.candidatesService.filterValues(query.field);
  }

  @Get("template.xlsx")
  async downloadTemplate() {
    return new StreamableFile(await this.candidatesService.buildTemplate(), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent("수험생 업로드 양식.xlsx")}`,
    });
  }

  @Get("export.xlsx")
  async exportData(@Query() query: CandidateListQueryDto) {
    return new StreamableFile(await this.candidatesService.streamExport(query.query), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent("수험생 데이터.xlsx")}`,
    });
  }

  @Post("exports")
  startExport(@Body() query: CandidateListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.uploads.startExport(query.query, user.id);
  }

  @Get("exports/:id")
  async downloadExport(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return new StreamableFile(await this.uploads.downloadExport(id, user.id), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      disposition: "attachment; filename*=UTF-8''" + encodeURIComponent("수험생 데이터.xlsx"),
    });
  }

  @Post("import/preview")
  @UseInterceptors(
    FileInterceptor("file", { dest: incomingUploadDirectory, limits: { fileSize: WORKBOOK_UPLOAD_MAX_BYTES } }),
  )
  preview(@UploadedFile() uploadedFile: DiskCandidateUpload | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.uploads.preview(uploadedFile, "WORKBOOK", user.id);
  }

  @Post("import")
  import(
    @Query() query: CandidateImportQueryDto,
    @Headers(CANDIDATE_PREVIEW_TOKEN_HEADER) previewToken: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uploads.enqueue(
      validateCandidatePreviewTokenHeader(previewToken),
      user.id,
      query.policy ?? "insert-update",
      "WORKBOOK",
    );
  }

  @Get("uploads/:id")
  uploadStatus(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.uploads.status(id, user.id);
  }

  @Post("photo-archive/preview")
  @UseInterceptors(
    FileInterceptor("file", { dest: incomingUploadDirectory, limits: { fileSize: PHOTO_ARCHIVE_UPLOAD_MAX_BYTES } }),
  )
  previewPhotoArchive(
    @UploadedFile() uploadedFile: DiskCandidateUpload | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uploads.preview(uploadedFile, "PHOTO_ARCHIVE", user.id);
  }

  @Get(":id/photo")
  async candidatePhoto(@Param("id", ParseIntPipe) id: number) {
    const photo = await this.candidatesService.photo(id);
    return new StreamableFile(photo.content, { type: photo.mimeType, disposition: "inline" });
  }

  @Put(":id/photo")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: PHOTO_ARCHIVE_MAX_ENTRY_BYTES, files: 1 } }))
  saveCandidatePhoto(
    @Param("id", ParseIntPipe) id: number,
    @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException("사진 파일을 선택해 주세요.");
    const fileName = normalizeMultipartFileName(file.originalname);
    const photo = validateCandidatePhotoBuffer(file.buffer, extname(fileName).slice(1));
    if (!photo) throw new BadRequestException("올바른 JPG, JPEG, PNG 사진을 선택해 주세요.");
    return this.candidatesService.savePhoto(id, { ...photo, fileName }, user.id);
  }

  @Get(":id")
  candidateDetail(@Param("id", ParseIntPipe) id: number) {
    return this.candidatesService.detail(id);
  }

  @Patch(":id")
  updateCandidate(
    @Param("id", ParseIntPipe) id: number,
    @Body() input: CandidateUpdateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.candidatesService.update(id, input, user.id);
  }

  @Post("photo-archive")
  importPhotoArchive(
    @Query() query: CandidateImportQueryDto,
    @Headers(CANDIDATE_PREVIEW_TOKEN_HEADER) previewToken: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uploads.enqueue(
      validateCandidatePreviewTokenHeader(previewToken),
      user.id,
      query.policy ?? "insert-update",
      "PHOTO_ARCHIVE",
    );
  }
}

export function validateCandidatePreviewTokenHeader(value: string | undefined): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048 || value.trim() !== value) {
    throw new BadRequestException("수험생 데이터 미리보기 토큰을 확인해 주세요.");
  }
  return value;
}
