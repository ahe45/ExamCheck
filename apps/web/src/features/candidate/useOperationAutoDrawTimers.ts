import { useEffect, useLayoutEffect, useRef, type Dispatch } from "react";
import type { Examinee, OperationSchedule } from "../../shared/api/examinees";
import type { AssignmentMode, PseudonymAssignment } from "../../shared/api/pseudonyms";
import {
  canRunScheduledAutoDraw,
  createOperationRequestTarget,
  isSameOperationRequestTarget,
  type AutoDrawRuntimeState,
  type OperationRequestTarget,
} from "./operation-request-guard";
import type { OperationCandidateAction } from "./operation-candidate-state";

interface RefValue<T> {
  current: T;
}

interface Options {
  scheduleKey: string;
  schedule: OperationSchedule;
  candidate: Examinee | null;
  assignment: PseudonymAssignment | null;
  assigning: boolean;
  drawPopoverOpen: boolean;
  selectedMode: AssignmentMode;
  operationClosed: boolean;
  autoDrawEnabled: boolean;
  autoDrawDelaySeconds: number;
  range: { start: number; end: number };
  attemptedTargetRef: RefValue<OperationRequestTarget | null>;
  runtimeRef: RefValue<AutoDrawRuntimeState>;
  dispatch: Dispatch<OperationCandidateAction>;
  assign(expectedTarget: OperationRequestTarget): void | Promise<void>;
}

export function useOperationAutoDrawTimers(options: Options) {
  const {
    scheduleKey,
    schedule,
    candidate,
    assignment,
    assigning,
    drawPopoverOpen,
    selectedMode,
    operationClosed,
    autoDrawEnabled,
    autoDrawDelaySeconds,
    range,
    attemptedTargetRef,
    runtimeRef,
    dispatch,
    assign,
  } = options;
  const assignRef = useRef(assign);

  useLayoutEffect(() => {
    assignRef.current = assign;
  });

  useEffect(() => {
    if (!drawPopoverOpen || selectedMode !== "RANDOM" || !candidate || assignment) return;
    const nextNumber = () =>
      dispatch({
        type: "SET_DRAW_PREVIEW",
        value: range.start + Math.floor(Math.random() * Math.max(1, range.end - range.start + 1)),
      });
    nextNumber();
    const timer = window.setInterval(nextNumber, 75);
    return () => window.clearInterval(timer);
  }, [assignment, candidate, dispatch, drawPopoverOpen, range.end, range.start, selectedMode]);

  useEffect(() => {
    if (
      !autoDrawEnabled ||
      operationClosed ||
      !drawPopoverOpen ||
      selectedMode !== "RANDOM" ||
      !candidate ||
      assignment ||
      assigning
    ) {
      dispatch({ type: "SET_DRAW_REMAINING", value: 0 });
      return;
    }
    const target = createOperationRequestTarget(candidate.examineeNo, schedule);
    if (isSameOperationRequestTarget(target, attemptedTargetRef.current)) {
      dispatch({ type: "SET_DRAW_REMAINING", value: 0 });
      return;
    }
    const totalMs = autoDrawDelaySeconds * 1000;
    const startedAt = Date.now();
    dispatch({ type: "SET_DRAW_REMAINING", value: totalMs });
    const countdown = window.setInterval(
      () => dispatch({ type: "SET_DRAW_REMAINING", value: Math.max(0, totalMs - (Date.now() - startedAt)) }),
      100,
    );
    const timer = window.setTimeout(() => {
      if (canRunScheduledAutoDraw(target, runtimeRef.current)) {
        attemptedTargetRef.current = target;
        void assignRef.current(target);
      }
    }, totalMs);
    return () => {
      window.clearInterval(countdown);
      window.clearTimeout(timer);
    };
  }, [
    assignment,
    assigning,
    attemptedTargetRef,
    autoDrawDelaySeconds,
    autoDrawEnabled,
    candidate,
    dispatch,
    drawPopoverOpen,
    operationClosed,
    runtimeRef,
    schedule,
    scheduleKey,
    selectedMode,
  ]);
}
