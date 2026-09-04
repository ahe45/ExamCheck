import type { RowDataPacket } from "mysql2/promise";

export interface ExamineeRow extends RowDataPacket {
  id: number;
  examineeNo: string;
  name: string;
  birthDate: string;
  examName: string;
  examDate: string | Date;
  roomName: string;
  seatNo: string;
  labelBarcode: string;
  preassignedNumber: string | null;
  preassignedAvailable: boolean;
  assignedNumber: string | null;
  assignmentMode: "RANDOM" | "SEQUENTIAL" | "MANUAL" | "PREASSIGNED" | null;
  assignedAt: Date | null;
  lastPrintedAt: Date | null;
  status: "ACTIVE" | "CANCELLED";
  examTime: string;
  examEndTime: string;
  periodName: string;
  periodCode: string;
  admissionName: string;
  admissionCode: string;
  unitName: string;
  unitCode: string;
  majorName: string;
  majorCode: string;
  buildingName: string;
  buildingCode: string;
  roomCode: string;
  groupName: string;
  opt1: string;
  opt2: string;
  opt3: string;
  absent: boolean;
}

export interface ExamineePhotoRow extends RowDataPacket {
  content: Buffer;
  mimeType: string;
}

export interface OperationScheduleRow extends RowDataPacket {
  date: string;
  time: string;
  periodName: string;
  admissionName: string;
  buildingNames: string | null;
  candidateCount: number;
  assignedCount: number;
}

export interface ExamineeScheduleRow extends RowDataPacket {
  examineeNo: string;
  name: string;
  examDate: string;
  examTime: string;
  periodName: string;
  admissionName: string;
  buildingName: string;
  roomName: string;
}

export type ExamineeLookupResult =
  | { status: "CURRENT"; examinee: ExamineeRow }
  | { status: "OTHER_SCHEDULE"; examineeNo: string; name: string; schedules: ExamineeScheduleRow[] }
  | { status: "NOT_FOUND"; examineeNo: string };

export interface OperationScheduleScope {
  date: string;
  time: string;
  periodName: string;
  admissionName: string;
}
