import type { Examinee, ExamineeScheduleAssignment } from "../../shared/api/examinees";
import type { PseudonymAssignment } from "../../shared/api/pseudonyms";

export interface OperationNotice {
  kind: "success" | "error";
  text: string;
}

export interface OperationScheduleMismatch {
  examineeNo: string;
  name: string;
  schedules: ExamineeScheduleAssignment[];
}

export interface OperationCandidateState {
  input: string;
  candidate: Examinee | null;
  photoUrl: string | null;
  manualNumber: string;
  assignment: PseudonymAssignment | null;
  searching: boolean;
  assigning: boolean;
  notice: OperationNotice | null;
  drawPopoverOpen: boolean;
  drawPreviewNumber: number;
  sequentialPreviewNumber: string | null;
  autoDrawRemainingMs: number;
  scheduleMismatch: OperationScheduleMismatch | null;
}

export type OperationCandidateAction =
  | { type: "SET_INPUT"; value: string }
  | { type: "SET_MANUAL_NUMBER"; value: string }
  | { type: "SET_NOTICE"; value: OperationNotice | null }
  | { type: "SET_DRAW_OPEN"; value: boolean }
  | { type: "SET_DRAW_PREVIEW"; value: number }
  | { type: "SET_SEQUENTIAL_PREVIEW"; value: string }
  | { type: "SET_DRAW_REMAINING"; value: number }
  | { type: "SET_SCHEDULE_MISMATCH"; value: OperationScheduleMismatch | null }
  | { type: "LOOKUP_STARTED" }
  | {
      type: "LOOKUP_RESOLVED";
      candidate: Examinee;
      assignment: PseudonymAssignment | null;
      notice: OperationNotice | null;
      drawPopoverOpen: boolean;
    }
  | { type: "LOOKUP_FINISHED" }
  | { type: "PHOTO_RESOLVED"; photoUrl: string }
  | { type: "ASSIGN_STARTED" }
  | { type: "ASSIGN_SUCCEEDED"; candidate: Examinee; assignment: PseudonymAssignment; notice: OperationNotice }
  | { type: "ASSIGN_FAILED"; notice: OperationNotice }
  | { type: "ASSIGN_FINISHED" }
  | { type: "RESET_LOOKUP"; previewNumber: number }
  | { type: "RESET_SCHEDULE"; previewNumber: number };

export function createOperationCandidateState(previewNumber: number): OperationCandidateState {
  return {
    input: "",
    candidate: null,
    photoUrl: null,
    manualNumber: "",
    assignment: null,
    searching: false,
    assigning: false,
    notice: null,
    drawPopoverOpen: false,
    drawPreviewNumber: previewNumber,
    sequentialPreviewNumber: null,
    autoDrawRemainingMs: 0,
    scheduleMismatch: null,
  };
}

export function operationCandidateReducer(
  state: OperationCandidateState,
  action: OperationCandidateAction,
): OperationCandidateState {
  if (action.type === "SET_INPUT") return { ...state, input: action.value };
  if (action.type === "SET_MANUAL_NUMBER") return { ...state, manualNumber: action.value };
  if (action.type === "SET_NOTICE") return { ...state, notice: action.value };
  if (action.type === "SET_DRAW_OPEN") return { ...state, drawPopoverOpen: action.value };
  if (action.type === "SET_SEQUENTIAL_PREVIEW")
    return { ...state, sequentialPreviewNumber: action.value, manualNumber: action.value };
  if (action.type === "SET_DRAW_PREVIEW") return { ...state, drawPreviewNumber: action.value };
  if (action.type === "SET_DRAW_REMAINING") return { ...state, autoDrawRemainingMs: action.value };
  if (action.type === "SET_SCHEDULE_MISMATCH") return { ...state, scheduleMismatch: action.value };
  if (action.type === "LOOKUP_STARTED") {
    return {
      ...state,
      candidate: null,
      photoUrl: null,
      assignment: null,
      searching: true,
      sequentialPreviewNumber: null,
      manualNumber: "",
      assigning: false,
      notice: null,
      drawPopoverOpen: false,
      autoDrawRemainingMs: 0,
      scheduleMismatch: null,
    };
  }
  if (action.type === "LOOKUP_RESOLVED") {
    return {
      ...state,
      candidate: action.candidate,
      assignment: action.assignment,
      notice: action.notice,
      drawPopoverOpen: action.drawPopoverOpen,
    };
  }
  if (action.type === "LOOKUP_FINISHED") return { ...state, searching: false };
  if (action.type === "PHOTO_RESOLVED") return { ...state, photoUrl: action.photoUrl };
  if (action.type === "ASSIGN_STARTED") return { ...state, assigning: true, notice: null };
  if (action.type === "ASSIGN_SUCCEEDED") {
    return { ...state, candidate: action.candidate, assignment: action.assignment, notice: action.notice };
  }
  if (action.type === "ASSIGN_FAILED") return { ...state, notice: action.notice };
  if (action.type === "ASSIGN_FINISHED") return { ...state, assigning: false };
  if (action.type === "RESET_LOOKUP") {
    return { ...createOperationCandidateState(action.previewNumber), scheduleMismatch: state.scheduleMismatch };
  }
  return createOperationCandidateState(action.previewNumber);
}
