import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from "class-validator";

export const PRINT_JOB_RETRY_REASON_CODES = ["CLIENT_SEND_RETRY", "PRINTER_RECOVERY"] as const;
export const PRINT_JOB_REPRINT_REASON_CODES = ["LABEL_DAMAGED", "PRINT_QUALITY_ISSUE", "OPERATOR_REQUEST"] as const;
export const PRINT_JOB_REISSUE_REASON_CODES = [
  ...PRINT_JOB_RETRY_REASON_CODES,
  ...PRINT_JOB_REPRINT_REASON_CODES,
] as const;

export type PrintJobRetryReasonCode = (typeof PRINT_JOB_RETRY_REASON_CODES)[number];
export type PrintJobReprintReasonCode = (typeof PRINT_JOB_REPRINT_REASON_CODES)[number];
export type PrintJobReissueReasonCode = (typeof PRINT_JOB_REISSUE_REASON_CODES)[number];

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

export class ReissuePrintJobDto {
  @IsUUID("4")
  idempotencyKey!: string;

  @IsIn(PRINT_JOB_REISSUE_REASON_CODES)
  reasonCode!: PrintJobReissueReasonCode;
}
