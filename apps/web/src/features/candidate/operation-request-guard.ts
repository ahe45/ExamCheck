import type { OperationScheduleScope } from "../../shared/api/examinees";

export interface OperationRequestTarget {
  examineeNo: string;
  scheduleKey: string;
}

export interface PhotoRequestIdentity {
  requestId: number;
  target: OperationRequestTarget;
}

export interface ScheduleRequestIdentity {
  requestId: number;
  scheduleKey: string;
}

export interface AutoDrawRuntimeState {
  target: OperationRequestTarget | null;
  popoverOpen: boolean;
  mode: string;
  operationClosed: boolean;
  assigned: boolean;
  assigning: boolean;
}

export function operationScheduleKey(schedule: OperationScheduleScope) {
  return [schedule.date, schedule.time, schedule.periodName, schedule.admissionName].join("\u001f");
}

export function createOperationRequestTarget(
  examineeNo: string,
  schedule: OperationScheduleScope,
): OperationRequestTarget {
  return { examineeNo: examineeNo.trim(), scheduleKey: operationScheduleKey(schedule) };
}

export function isSameOperationRequestTarget(
  left: OperationRequestTarget | null,
  right: OperationRequestTarget | null,
) {
  return Boolean(left && right && left.examineeNo === right.examineeNo && left.scheduleKey === right.scheduleKey);
}

export function isCurrentTargetRequest(
  request: PhotoRequestIdentity,
  currentRequestId: number,
  currentTarget: OperationRequestTarget | null,
) {
  return request.requestId === currentRequestId && isSameOperationRequestTarget(request.target, currentTarget);
}

export const isCurrentPhotoRequest = isCurrentTargetRequest;

export function isCurrentScheduleRequest(
  request: ScheduleRequestIdentity,
  currentRequestId: number,
  currentScheduleKey: string,
) {
  return request.requestId === currentRequestId && request.scheduleKey === currentScheduleKey;
}

export function canRunScheduledAutoDraw(expectedTarget: OperationRequestTarget, current: AutoDrawRuntimeState) {
  return (
    isSameOperationRequestTarget(expectedTarget, current.target) &&
    current.popoverOpen &&
    current.mode === "RANDOM" &&
    !current.operationClosed &&
    !current.assigned &&
    !current.assigning
  );
}
