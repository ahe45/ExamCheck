export type PseudonymAssignmentMode = "RANDOM" | "SEQUENTIAL" | "MANUAL" | "PREASSIGNED";

export type PseudonymAssignmentMethod = "DRAW" | "SEQUENTIAL" | "MATCHING" | "PREASSIGNED";

export interface AssignPseudonymInput {
  examName?: string;
  examineeNo: string;
  mode: PseudonymAssignmentMode;
  manualNumber?: string;
  examDate: string;
  examTime: string;
  periodName: string;
  admissionName: string;
}

export interface PseudonymOperationScopeInput {
  examName: string;
  examDate: string;
  examTime: string;
  periodName: string;
  admissionName: string;
}

export interface AdmissionOperationScheduleInput {
  examDate: string;
  examTime: string;
  periodName: string;
}

export interface ResetAdmissionOperationsInput {
  examName: string;
  admissionName: string;
  schedules: AdmissionOperationScheduleInput[];
}

export interface DeleteAdmissionInput {
  admissionName: string;
  currentPassword: string;
}

export interface PseudonymTimeRangeInput {
  date: string;
  time: string;
  period: string;
  admission: string;
  unit: string;
  major: string;
  building: string;
  room: string;
  rangeStart: number;
  rangeEnd: number;
  displayWidth?: number;
}

export interface UpdatePseudonymSettingInput {
  expectedVersion: number;
  examName: string;
  admissionName: string;
  rangeStart: number;
  rangeEnd: number;
  displayWidth?: number;
  assignmentMethod: PseudonymAssignmentMethod;
  autoDrawEnabled: boolean;
  autoDrawDelaySeconds: number;
  printPreassignedLabel: boolean;
  labelTemplateId?: number | null;
  autoAssignAbsenteesOnClose: boolean;
  deleteAbsenteeInfoOnReopen: boolean;
  useCandidatePhotos: boolean;
  enableBulkDraw: boolean;
  ranges: PseudonymTimeRangeInput[];
}
