import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import {
  PSEUDONYM_ROSTER_EXPORT_FIELDS,
  PSEUDONYM_ROSTER_EXPORT_MAX_FILTER_VALUES,
  type PseudonymRosterExportField,
  type PseudonymRosterFilterMode,
} from "./pseudonym-roster-query.js";
import type {
  AssignPseudonymInput,
  PseudonymOperationScopeInput,
  PseudonymTimeRangeInput,
  ResetAdmissionOperationsInput,
  DeleteAdmissionInput,
  AdmissionOperationScheduleInput,
  UpdatePseudonymSettingInput,
} from "./pseudonyms.types.js";

export class PseudonymSettingQueryDto {
  @IsString()
  @Length(1, 200)
  examName!: string;

  @IsString()
  @Length(1, 200)
  admissionName!: string;
}

export class PseudonymSettingsOverviewQueryDto {
  @IsString()
  @Length(1, 200)
  @Matches(/\S/)
  examName!: string;
}

export class AdmissionOperationScheduleDto implements AdmissionOperationScheduleInput {
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
}

export class ResetAdmissionOperationsDto implements ResetAdmissionOperationsInput {
  @IsString()
  @Length(1, 200)
  examName!: string;

  @IsString()
  @Length(1, 200)
  admissionName!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique((schedule: AdmissionOperationScheduleDto) =>
    [schedule.examDate, schedule.examTime, schedule.periodName].join("\u001f"),
  )
  @ValidateNested({ each: true })
  @Type(() => AdmissionOperationScheduleDto)
  schedules!: AdmissionOperationScheduleDto[];
}

export class DeleteAdmissionDto implements DeleteAdmissionInput {
  @IsString()
  @Length(1, 200)
  admissionName!: string;

  @IsString()
  @Length(1, 1024)
  currentPassword!: string;
}

export class AssignPseudonymDto implements AssignPseudonymInput {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  examName?: string;

  @IsString()
  @Length(1, 50)
  examineeNo!: string;

  @IsIn(["RANDOM", "SEQUENTIAL", "MANUAL", "PREASSIGNED"])
  mode!: "RANDOM" | "SEQUENTIAL" | "MANUAL" | "PREASSIGNED";

  @IsOptional()
  @IsString()
  @Length(1, 50)
  manualNumber?: string;

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

export class PseudonymOperationScopeDto implements PseudonymOperationScopeInput {
  @IsString()
  @Length(1, 200)
  examName!: string;

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

export class ExportPseudonymRosterFilterDto {
  @IsIn([...PSEUDONYM_ROSTER_EXPORT_FIELDS])
  field!: PseudonymRosterExportField;

  @IsIn(["include", "exclude"])
  mode!: PseudonymRosterFilterMode;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PSEUDONYM_ROSTER_EXPORT_MAX_FILTER_VALUES)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 200, { each: true })
  values!: string[];
}

export class ExportPseudonymRosterSortDto {
  @IsIn([...PSEUDONYM_ROSTER_EXPORT_FIELDS])
  field!: PseudonymRosterExportField;

  @IsIn(["asc", "desc"])
  direction!: "asc" | "desc";
}

export class ExportPseudonymRosterQueryDto {
  @IsArray()
  @ArrayMaxSize(PSEUDONYM_ROSTER_EXPORT_FIELDS.length)
  @ArrayUnique((filter: ExportPseudonymRosterFilterDto) => filter.field)
  @ValidateNested({ each: true })
  @Type(() => ExportPseudonymRosterFilterDto)
  filters!: ExportPseudonymRosterFilterDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ExportPseudonymRosterSortDto)
  sort?: ExportPseudonymRosterSortDto;
}

export class ExportPseudonymRosterDto extends PseudonymOperationScopeDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => ExportPseudonymRosterQueryDto)
  query!: ExportPseudonymRosterQueryDto;
}

export class UpdatePseudonymSettingDto implements UpdatePseudonymSettingInput {
  @IsInt()
  @Min(0)
  @Max(2147483647)
  expectedVersion!: number;

  @IsString()
  @Length(1, 200)
  examName!: string;

  @IsString()
  @Length(1, 200)
  admissionName!: string;

  @IsInt()
  @Min(1)
  @Max(999999999)
  rangeStart!: number;

  @IsInt()
  @Min(1)
  @Max(999999999)
  rangeEnd!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  displayWidth?: number;

  @IsIn(["DRAW", "SEQUENTIAL", "MATCHING", "PREASSIGNED"])
  assignmentMethod!: "DRAW" | "SEQUENTIAL" | "MATCHING" | "PREASSIGNED";

  @IsBoolean()
  autoDrawEnabled!: boolean;

  @IsInt()
  @Min(1)
  @Max(60)
  autoDrawDelaySeconds!: number;

  @IsBoolean()
  printPreassignedLabel!: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  labelTemplateId?: number | null;

  @IsBoolean()
  autoAssignAbsenteesOnClose!: boolean;

  @IsBoolean()
  deleteAbsenteeInfoOnReopen!: boolean;

  @IsBoolean()
  useCandidatePhotos!: boolean;

  @IsBoolean()
  enableBulkDraw!: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PseudonymTimeRangeDto)
  ranges!: PseudonymTimeRangeDto[];
}

export class PseudonymTimeRangeDto implements PseudonymTimeRangeInput {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true, strictSeparator: true })
  date!: string;

  @IsString()
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  time!: string;

  @IsString()
  @Length(0, 100)
  period!: string;

  @IsString()
  @Length(0, 200)
  admission!: string;

  @IsString()
  @Length(0, 200)
  unit!: string;

  @IsString()
  @Length(0, 200)
  major!: string;

  @IsString()
  @Length(0, 200)
  building!: string;

  @IsString()
  @Length(0, 200)
  room!: string;

  @IsInt()
  @Min(1)
  @Max(999999999)
  rangeStart!: number;

  @IsInt()
  @Min(1)
  @Max(999999999)
  rangeEnd!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  displayWidth?: number;
}
