import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from "class-validator";

export class CreatePrintJobDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  examName?: string;

  @IsUUID("4")
  idempotencyKey!: string;

  @IsString()
  @Length(1, 50)
  examineeNo!: string;

  @IsString()
  @Length(1, 100)
  workstationCode!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  copies!: number;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true, strictSeparator: true })
  examDate!: string;

  @IsString()
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  examTime!: string;

  @IsString()
  @Length(1, 100)
  periodName!: string;

  @IsString()
  @Length(1, 200)
  admissionName!: string;
}

export class CompletePrintJobDto {
  @IsIn(["SENT", "FAILED"])
  status!: "SENT" | "FAILED";

  @IsOptional()
  @IsString()
  @Length(1, 500)
  errorMessage?: string;
}
