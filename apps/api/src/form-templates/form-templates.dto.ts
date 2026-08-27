import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Length, Matches } from "class-validator";
import type { SaveFormTemplateInput, UpdateFormTemplateMetadataInput } from "./form-templates.types.js";

export class FormTemplateCodeParamDto {
  @IsString()
  @Length(2, 100)
  @Matches(/^[A-Z0-9_]+$/)
  code!: string;
}

export class SaveFormTemplateDto implements SaveFormTemplateInput {
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

  @IsString()
  @Length(1, 100)
  category!: string;

  @IsIn(["CANDIDATE", "ROOM", "EXAM"])
  usageScope!: "CANDIDATE" | "ROOM" | "EXAM";

  @IsObject()
  layout!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateFormTemplateMetadataDto implements UpdateFormTemplateMetadataInput {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;
}
