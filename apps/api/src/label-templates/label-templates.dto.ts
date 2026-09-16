import { IsBoolean, IsInt, Min, Max, IsObject, IsOptional, IsString, Length, Matches } from "class-validator";

export class LabelTemplateCodeParamDto {
  @IsString()
  @Length(2, 100)
  @Matches(/^[A-Z0-9_]+$/)
  code!: string;
}

export class SaveLabelTemplateDto {
  @IsString()
  @Length(2, 100)
  @Matches(/^[A-Z0-9_]+$/)
  code!: string;

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  defaultCopies?: number;

  @IsObject()
  layout!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class PreviewLabelTemplateDto {
  @IsObject()
  layout!: Record<string, unknown>;
}

export class UpdateLabelTemplateMetadataDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;
}

export class UpdateLabelTemplateActiveDto {
  @IsBoolean()
  active!: boolean;
}
