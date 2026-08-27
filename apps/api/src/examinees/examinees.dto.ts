import { IsDateString, IsString, Length, Matches } from "class-validator";

export class ExamineeNumberParamDto {
  @IsString()
  @Length(1, 50)
  examineeNo!: string;
}

export class OperationScheduleQueryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true, strictSeparator: true })
  date!: string;

  @IsString()
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  time!: string;

  @IsString()
  @Length(1, 100)
  periodName!: string;

  @IsString()
  @Length(1, 200)
  admissionName!: string;
}
