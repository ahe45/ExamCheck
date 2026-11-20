import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";
import { CLASSIFICATION_METHODS, type ClassificationMethod } from "../authorization/classification.js";
import type { ExamineeNoUniqueness, PseudonymNoUniqueness } from "../uniqueness/number-uniqueness.js";

export class UpdateDeveloperSettingsDto {
  @IsString()
  @Length(1, 200)
  schoolName!: string;

  @IsInt()
  @Min(2000)
  @Max(2100)
  academicYear!: number;

  @IsString()
  @Length(1, 200)
  systemName!: string;

  @IsOptional()
  @IsIn(["SYSTEM", "SCHEDULE"])
  examineeNoUniqueness?: ExamineeNoUniqueness;

  @IsOptional()
  @IsIn(["ADMISSION", "SCHEDULE"])
  pseudonymNoUniqueness?: PseudonymNoUniqueness;

  @IsOptional()
  @IsIn(CLASSIFICATION_METHODS)
  classificationMethod?: ClassificationMethod;
}

export class ChangeDeveloperPasswordDto {
  @IsString()
  @Length(4, 200)
  currentPassword!: string;

  @IsString()
  @Length(4, 200)
  newPassword!: string;
}

export class UpdateHistoryResetPasswordDto {
  @IsString()
  @Length(4, 200)
  newPassword!: string;
}
