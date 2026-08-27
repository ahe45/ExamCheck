import { ArrayUnique, IsArray, IsIn, IsOptional, IsString, Length, MaxLength } from "class-validator";

export class CreateAccountDto {
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
