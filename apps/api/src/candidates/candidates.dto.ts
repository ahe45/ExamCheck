import { IsIn, IsOptional, IsString, Length } from "class-validator";
import type { CandidateUploadPolicy } from "./candidate-domain.js";

export class CandidateDashboardQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  admissionName?: string;
}

export class CandidateImportQueryDto {
  @IsOptional()
  @IsIn(["insert-only", "insert-update", "all"])
  policy?: CandidateUploadPolicy;
}

export class CandidateListQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 2000000)
  query?: string;
}

export class CandidateFilterQueryDto {
  @IsString()
  @Length(1, 40)
  field!: string;
}
