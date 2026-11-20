import { ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional, IsString, Length, MaxLength } from "class-validator";
import { CLASSIFICATION_METHODS, type ClassificationMethod } from "../authorization/classification.js";

export class CreateAccountDto {
  @IsOptional()
  @IsIn(CLASSIFICATION_METHODS)
  classificationMethod?: ClassificationMethod;
  @IsString()
  @Length(1, 100)
  loginId!: string;

  @IsIn(["ADMIN", "USER"])
  role!: "ADMIN" | "USER";

  @IsString()
  @Length(4, 200)
  password!: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  admissionNames!: string[];
}

export class UpdateAccountDto {
  @IsOptional()
  @IsIn(CLASSIFICATION_METHODS)
  classificationMethod?: ClassificationMethod;

  @IsOptional()
  @IsBoolean()
  preserveClassificationAccess?: boolean;
  @IsString()
  @Length(1, 100)
  loginId!: string;

  @IsIn(["ADMIN", "USER"])
  role!: "ADMIN" | "USER";

  @IsOptional()
  @IsString()
  @Length(4, 200)
  password?: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  admissionNames!: string[];
}
