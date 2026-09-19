import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import {
  fetchExamineePhoto,
  lookupExaminee as fetchExamineeLookup,
  type Examinee,
  type OperationSchedule,
} from "../../shared/api/examinees";
import {
  assignPseudonym,
  previewSequentialPseudonym,
  type AssignmentMode,
  type PseudonymAssignment,
  type PseudonymTimeRange,
} from "../../shared/api/pseudonyms";
import {
  createOperationRequestTarget,
  isCurrentScheduleRequest,
  isCurrentTargetRequest,
  isSameOperationRequestTarget,
  operationScheduleKey,
  type AutoDrawRuntimeState,
  type OperationRequestTarget,
} from "./operation-request-guard";
import { assignmentFromExaminee } from "./operation-view-model";
import {
  createOperationCandidateState,
  operationCandidateReducer,
  type OperationNotice,
  type OperationScheduleMismatch,
} from "./operation-candidate-state";
import { useOperationAutoDrawTimers } from "./useOperationAutoDrawTimers";
import { useObjectUrlLifecycle, useOperationPhotoRequest } from "./useOperationPhotoRequest";

export { operationCandidateReducer } from "./operation-candidate-state";
export type { OperationCandidateState, OperationNotice, OperationScheduleMismatch } from "./operation-candidate-state";

interface OperationCandidateServices {
  lookupExaminee: typeof fetchExamineeLookup;
  fetchPhoto: typeof fetchExamineePhoto;
  assignPseudonym: typeof assignPseudonym;
  previewSequential?: typeof previewSequentialPseudonym;
}

const defaultServices: OperationCandidateServices = {
  lookupExaminee: fetchExamineeLookup,
  fetchPhoto: fetchExamineePhoto,
  assignPseudonym,
};

interface Options {
  token: string;
  userRole: string;
  schedule: OperationSchedule;
  selectedMode: AssignmentMode;
  operationClosed: boolean;
  operationStatusLoaded: boolean;
  configuredRanges: PseudonymTimeRange[];
  useCandidatePhotos: boolean;
  showAttendanceSelection?: boolean;
  range: { start: number; end: number };
  autoDrawEnabled: boolean;
  autoDrawDelaySeconds: number;
  onRangeChange(range: { start: number; end: number }): void;
  onAssigned(candidate: Examinee, assignment: PseudonymAssignment): void;
  services?: OperationCandidateServices;
}

export function useOperationCandidateController(options: Options) {
  const [state, dispatch] = useReducer(operationCandidateReducer, options.range.start, createOperationCandidateState);
  const stateRef = useRef(state);
  const optionsRef = useRef(options);
  const lookupRequestSequenceRef = useRef(0);
  const lookupRequestRef = useRef<{ requestId: number; scheduleKey: string; controller: AbortController } | null>(null);
  const assignmentRequestSequenceRef = useRef(0);
  const assignmentRequestRef = useRef<{ requestId: number; target: OperationRequestTarget } | null>(null);
  const currentOperationTargetRef = useRef<OperationRequestTarget | null>(null);
  const autoDrawAttemptedTargetRef = useRef<OperationRequestTarget | null>(null);
  const currentScheduleKey = operationScheduleKey(options.schedule);
  const currentScheduleKeyRef = useRef(currentScheduleKey);
  const autoDrawRuntimeRef = useRef<AutoDrawRuntimeState>({
    target: null,
    popoverOpen: false,
    mode: "RANDOM",
    operationClosed: false,
    assigned: false,
    assigning: false,
  });
  const { cancelPhotoRequest, requestPhoto } = useOperationPhotoRequest(currentOperationTargetRef, dispatch);

  useLayoutEffect(() => {
    stateRef.current = state;
    optionsRef.current = options;
    currentScheduleKeyRef.current = currentScheduleKey;
    const target = state.candidate ? createOperationRequestTarget(state.candidate.examineeNo, options.schedule) : null;
    currentOperationTargetRef.current = target;
    autoDrawRuntimeRef.current = {
      target,
      popoverOpen: state.drawPopoverOpen,
      mode: options.selectedMode,
      operationClosed: options.operationClosed,
      assigned: Boolean(state.assignment),
      assigning: state.assigning,
    };
  });

  const cancelLookupRequest = useCallback(() => {
    lookupRequestRef.current?.controller.abort();
    lookupRequestRef.current = null;
    lookupRequestSequenceRef.current += 1;
  }, []);

  const invalidateAssignmentRequest = useCallback(() => {
    assignmentRequestRef.current = null;
    assignmentRequestSequenceRef.current += 1;
    autoDrawRuntimeRef.current = { ...autoDrawRuntimeRef.current, assigning: false };
  }, []);

  const invalidateLookupTarget = useCallback(() => {
    currentOperationTargetRef.current = null;
    autoDrawAttemptedTargetRef.current = null;
    autoDrawRuntimeRef.current = { ...autoDrawRuntimeRef.current, target: null, popoverOpen: false };
  }, []);

  const cancelLifecycle = useCallback(() => {
    cancelLookupRequest();
    cancelPhotoRequest();
    invalidateAssignmentRequest();
    invalidateLookupTarget();
  }, [cancelLookupRequest, cancelPhotoRequest, invalidateAssignmentRequest, invalidateLookupTarget]);

  useEffect(() => {
    cancelLifecycle();
    dispatch({ type: "RESET_SCHEDULE", previewNumber: optionsRef.current.range.start });
  }, [cancelLifecycle, currentScheduleKey]);

  useEffect(() => () => cancelLifecycle(), [cancelLifecycle]);

  useEffect(() => {
    if (options.showAttendanceSelection === false) dispatch({ type: "RESET_ATTENDANCE" });
  }, [options.showAttendanceSelection]);

  useObjectUrlLifecycle(state.photoUrl);

  useOperationAutoDrawTimers({
    scheduleKey: currentScheduleKey,
    schedule: options.schedule,
    candidate: state.candidate,
    assignment: state.assignment,
    assigning: state.assigning,
    drawPopoverOpen: state.drawPopoverOpen,
    selectedMode: options.selectedMode,
    operationClosed: options.operationClosed,
    autoDrawEnabled: options.autoDrawEnabled,
    autoDrawDelaySeconds: options.autoDrawDelaySeconds,
    range: options.range,
    attemptedTargetRef: autoDrawAttemptedTargetRef,
    runtimeRef: autoDrawRuntimeRef,
    dispatch,
    assign,
  });

  const lookupExaminee = useCallback(
    async (examineeNo: string) => {
      const normalizedExamineeNo = examineeNo.trim();
      if (!normalizedExamineeNo || stateRef.current.searching || lookupRequestRef.current) return;
      cancelLookupRequest();
      cancelPhotoRequest();
      invalidateAssignmentRequest();
      invalidateLookupTarget();
      const config = optionsRef.current;
      const requestId = lookupRequestSequenceRef.current + 1;
      lookupRequestSequenceRef.current = requestId;
      const controller = new AbortController();
      const request = { requestId, scheduleKey: operationScheduleKey(config.schedule), controller };
      lookupRequestRef.current = request;
      dispatch({ type: "LOOKUP_STARTED" });
      try {
        const lookup = await (config.services || defaultServices).lookupExaminee(
          normalizedExamineeNo,
          config.token,
          config.schedule,
          controller.signal,
        );
        if (!isCurrentScheduleRequest(request, lookupRequestSequenceRef.current, currentScheduleKeyRef.current)) return;
        if (lookup.status === "NOT_FOUND") {
          dispatch({ type: "SET_NOTICE", value: { kind: "error", text: "존재하지 않는 수험번호입니다." } });
          return;
        }
        if (lookup.status === "OTHER_SCHEDULE") {
          dispatch({
            type: "SET_SCHEDULE_MISMATCH",
            value: { examineeNo: lookup.examineeNo, name: lookup.name, schedules: lookup.schedules },
          });
          return;
        }
        const found = lookup.examinee;
        const requestTarget = createOperationRequestTarget(found.examineeNo, config.schedule);
        currentOperationTargetRef.current = requestTarget;
        const scheduleRange = config.configuredRanges.find(
          (item) =>
            item.date === found.examDate &&
            item.time === found.examTime &&
            item.period === found.periodName &&
            item.admission === found.admissionName &&
            item.unit === found.unitName &&
            item.major === found.majorName &&
            item.building === found.buildingName &&
            item.room === found.roomName,
        );
        if (scheduleRange) config.onRangeChange({ start: scheduleRange.rangeStart, end: scheduleRange.rangeEnd });

        const currentAssignment = assignmentFromExaminee(found);
        const notice =
          !currentAssignment && config.selectedMode === "PREASSIGNED" && !found.preassignedAvailable
            ? { kind: "error" as const, text: "사전 등록된 가번호가 없습니다." }
            : null;
        dispatch({
          type: "LOOKUP_RESOLVED",
          candidate: found,
          assignment: currentAssignment,
          notice,
          drawPopoverOpen:
            !currentAssignment &&
            (config.selectedMode === "RANDOM" ||
              config.selectedMode === "SEQUENTIAL" ||
              config.selectedMode === "MANUAL") &&
            !config.operationClosed &&
            config.userRole !== "VIEWER",
        });
        if (currentAssignment) config.onAssigned(found, currentAssignment);

        if (config.useCandidatePhotos) {
          requestPhoto(requestTarget, (signal) =>
            (config.services || defaultServices).fetchPhoto(found.examineeNo, config.token, config.schedule, signal),
          );
        }
        if (
          !currentAssignment &&
          config.selectedMode === "SEQUENTIAL" &&
          !config.operationClosed &&
          config.userRole !== "VIEWER"
        ) {
          const preview = await (config.services?.previewSequential || previewSequentialPseudonym)(
            config.token,
            found.examineeNo,
            {
              examName: found.examName,
              examDate: config.schedule.date,
              examTime: config.schedule.time,
              periodName: config.schedule.periodName,
              admissionName: config.schedule.admissionName,
            },
            controller.signal,
          );
          if (!isCurrentScheduleRequest(request, lookupRequestSequenceRef.current, currentScheduleKeyRef.current))
            return;
          dispatch({ type: "SET_SEQUENTIAL_PREVIEW", value: preview.pseudonymNumber });
        }
        return { candidate: found, assignment: currentAssignment };
      } catch (reason) {
        if (isCurrentScheduleRequest(request, lookupRequestSequenceRef.current, currentScheduleKeyRef.current)) {
          dispatch({
            type: "SET_NOTICE",
            value: { kind: "error", text: reason instanceof Error ? reason.message : "수험생을 조회하지 못했습니다." },
          });
        }
      } finally {
        if (isCurrentScheduleRequest(request, lookupRequestSequenceRef.current, currentScheduleKeyRef.current)) {
          lookupRequestRef.current = null;
          dispatch({ type: "LOOKUP_FINISHED" });
        }
      }
    },
    [cancelLookupRequest, cancelPhotoRequest, invalidateAssignmentRequest, invalidateLookupTarget, requestPhoto],
  );

  async function assign(expectedTarget?: OperationRequestTarget) {
    const snapshot = stateRef.current;
    const config = optionsRef.current;
    if (!snapshot.candidate || snapshot.assigning || assignmentRequestRef.current || config.userRole === "VIEWER")
      return;
    if (config.selectedMode === "SEQUENTIAL" && snapshot.sequentialPreviewNumber === null) return;
    if ((config.selectedMode === "MANUAL" || config.selectedMode === "SEQUENTIAL") && !snapshot.manualNumber.trim())
      return;
    const requestTarget = createOperationRequestTarget(snapshot.candidate.examineeNo, config.schedule);
    if (expectedTarget && !isSameOperationRequestTarget(expectedTarget, currentOperationTargetRef.current)) return;
    if (config.operationClosed) {
      dispatch({
        type: "SET_NOTICE",
        value: { kind: "error", text: "가번호 등록이 마감되어 더 이상 가번호를 부여할 수 없습니다." },
      });
      return;
    }
    const requestId = assignmentRequestSequenceRef.current + 1;
    assignmentRequestSequenceRef.current = requestId;
    const request = { requestId, target: requestTarget };
    assignmentRequestRef.current = request;
    if (config.autoDrawEnabled && config.selectedMode === "RANDOM") {
      autoDrawAttemptedTargetRef.current = requestTarget;
    }
    autoDrawRuntimeRef.current = { ...autoDrawRuntimeRef.current, assigning: true };
    dispatch({ type: "ASSIGN_STARTED" });
    try {
      const result = await (config.services || defaultServices).assignPseudonym(
        config.token,
        snapshot.candidate.examineeNo,
        config.selectedMode,
        {
          examName: snapshot.candidate.examName,
          examDate: config.schedule.date,
          examTime: config.schedule.time,
          periodName: config.schedule.periodName,
          admissionName: config.schedule.admissionName,
        },
        snapshot.manualNumber.trim() || undefined,
        config.selectedMode === "SEQUENTIAL" ? snapshot.sequentialPreviewNumber! : undefined,
        snapshot.registrationAbsent && config.showAttendanceSelection !== false,
      );
      const updated = {
        ...snapshot.candidate,
        assignedNumber: result.pseudonymNumber,
        assignmentMode: result.mode,
        assignedAt: String(result.assignedAt),
        absent: result.absent ?? snapshot.candidate.absent ?? false,
      };
      if (!isCurrentTargetRequest(request, assignmentRequestSequenceRef.current, currentOperationTargetRef.current))
        return;
      dispatch({
        type: "ASSIGN_SUCCEEDED",
        candidate: updated,
        assignment: result,
        notice: {
          kind: "success",
          text: result.alreadyAssigned ? "이미 부여된 가번호를 확인했습니다." : "가번호가 정상적으로 부여되었습니다.",
        },
      });
      config.onAssigned(updated, result);
    } catch (reason) {
      if (isCurrentTargetRequest(request, assignmentRequestSequenceRef.current, currentOperationTargetRef.current)) {
        dispatch({
          type: "ASSIGN_FAILED",
          notice: { kind: "error", text: reason instanceof Error ? reason.message : "가번호를 부여하지 못했습니다." },
        });
      }
    } finally {
      if (assignmentRequestRef.current?.requestId === requestId) {
        assignmentRequestRef.current = null;
        autoDrawRuntimeRef.current = { ...autoDrawRuntimeRef.current, assigning: false };
        dispatch({ type: "ASSIGN_FINISHED" });
      }
    }
  }

  const resetLookup = useCallback(() => {
    cancelLifecycle();
    dispatch({ type: "RESET_LOOKUP", previewNumber: optionsRef.current.range.start });
  }, [cancelLifecycle]);

  const setInput = useCallback((value: string) => dispatch({ type: "SET_INPUT", value }), []);
  const setManualNumber = useCallback((value: string) => dispatch({ type: "SET_MANUAL_NUMBER", value }), []);
  const setNotice = useCallback((value: OperationNotice | null) => dispatch({ type: "SET_NOTICE", value }), []);
  const setDrawPopoverOpen = useCallback((value: boolean) => dispatch({ type: "SET_DRAW_OPEN", value }), []);
  const setScheduleMismatch = useCallback(
    (value: OperationScheduleMismatch | null) => dispatch({ type: "SET_SCHEDULE_MISMATCH", value }),
    [],
  );
  const selectOperationRow = useCallback(
    (examineeNo: string) => {
      if (stateRef.current.searching) return;
      dispatch({ type: "SET_INPUT", value: examineeNo });
      void lookupExaminee(examineeNo);
    },
    [lookupExaminee],
  );

  return {
    ...state,
    canAssign:
      options.operationStatusLoaded &&
      !options.operationClosed &&
      Boolean(state.candidate) &&
      !state.assignment &&
      (!(options.selectedMode === "MANUAL" || options.selectedMode === "SEQUENTIAL") ||
        Boolean(state.manualNumber.trim())) &&
      (options.selectedMode !== "SEQUENTIAL" || state.sequentialPreviewNumber !== null) &&
      options.userRole !== "VIEWER",
    setRegistrationAbsent: (value: boolean) => {
      if (!stateRef.current.assigning && !stateRef.current.searching)
        dispatch({ type: "SET_REGISTRATION_ABSENT", value });
    },
    setAttendanceLocked: (value: boolean) => {
      if (!stateRef.current.assigning && !stateRef.current.searching)
        dispatch({ type: "SET_ATTENDANCE_LOCKED", value });
    },
    setInput,
    setManualNumber,
    setNotice,
    setDrawPopoverOpen,
    setScheduleMismatch,
    lookupExaminee,
    selectOperationRow,
    resetLookup,
    assign,
    isCurrentTarget: (target: OperationRequestTarget) =>
      isSameOperationRequestTarget(target, currentOperationTargetRef.current),
  };
}
