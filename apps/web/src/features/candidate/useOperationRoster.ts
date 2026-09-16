import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchOperationRoster, type Examinee, type OperationSchedule } from "../../shared/api/examinees";
import {
  closePseudonymOperation,
  reopenPseudonymOperation,
  downloadPseudonymRosterExcel,
  fetchPseudonymOperationStatus,
  type PseudonymAssignment,
  type PseudonymOperationStatus,
  type PseudonymRosterExportQuery,
} from "../../shared/api/pseudonyms";
import type { OperationNotice } from "./operation-candidate-state";
import { operationScope, safeFileName, toOperationRows, type OperationRow } from "./operation-view-model";

function initialOperationStatus(): PseudonymOperationStatus {
  return {
    closed: false,
    closedAt: null,
    closedByLoginId: null,
    autoAssignedAbsenteeCount: 0,
  };
}

interface Options {
  token: string;
  examName: string;
  schedule: OperationSchedule;
  scheduleKey: string;
  onNotice(notice: OperationNotice | null): void;
}

export function useOperationRoster(options: Options) {
  const { token, examName, schedule, scheduleKey, onNotice } = options;
  const currentScheduleKeyRef = useRef(scheduleKey);
  const [rows, setRows] = useState<OperationRow[]>([]);
  const [status, setStatus] = useState<PseudonymOperationStatus>(initialOperationStatus);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [closing, setClosing] = useState(false);
  const statusChangePendingRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  useLayoutEffect(() => {
    currentScheduleKeyRef.current = scheduleKey;
  }, [scheduleKey]);

  const isCurrentSchedule = useCallback((scheduleKey: string) => currentScheduleKeyRef.current === scheduleKey, []);

  useEffect(() => {
    setRows([]);
    setStatus(initialOperationStatus());
    setStatusLoaded(false);
    setClosing(false);
    setRefreshing(false);
    setExporting(false);
  }, [scheduleKey]);

  useEffect(() => {
    let active = true;
    onNotice(null);
    setStatusLoaded(false);
    void Promise.all([
      fetchOperationRoster(token, schedule),
      fetchPseudonymOperationStatus(token, operationScope(schedule, examName)),
    ])
      .then(([nextRows, nextStatus]) => {
        if (!active) return;
        setRows(toOperationRows(nextRows));
        setStatus(nextStatus);
        setStatusLoaded(true);
      })
      .catch((reason) => {
        if (active) {
          onNotice({
            kind: "error",
            text: reason instanceof Error ? reason.message : "교시 수험생 데이터를 불러오지 못했습니다.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [examName, onNotice, schedule, token]);

  const addRow = useCallback((candidate: Examinee, assignment: PseudonymAssignment) => {
    setRows((current) =>
      current.some((row) => row.candidate.examineeNo === candidate.examineeNo)
        ? current.map((row) => (row.candidate.examineeNo === candidate.examineeNo ? { candidate, assignment } : row))
        : [{ candidate, assignment }, ...current],
    );
  }, []);

  async function finish(onClosed: () => void) {
    return changeRegistrationStatus(false, onClosed);
  }

  async function reopen(onReopened: () => void) {
    return changeRegistrationStatus(true, onReopened);
  }

  async function changeRegistrationStatus(reopening: boolean, onChanged: () => void) {
    if (!statusLoaded || closing || statusChangePendingRef.current || status.closed !== reopening) return;
    statusChangePendingRef.current = true;
    const requestScheduleKey = scheduleKey;
    setClosing(true);
    onNotice(null);
    try {
      const nextStatus = await (reopening ? reopenPseudonymOperation : closePseudonymOperation)(
        token,
        operationScope(schedule, examName),
      );
      if (!isCurrentSchedule(requestScheduleKey)) return;
      setStatus(nextStatus);
      onChanged();
      let nextRows: Examinee[];
      try {
        nextRows = await fetchOperationRoster(token, schedule);
      } catch {
        if (isCurrentSchedule(requestScheduleKey)) {
          onNotice({
            kind: "error",
            text: `${reopening ? "마감 취소" : "마감"}는 완료되었지만 목록을 불러오지 못했습니다. 새로고침해 주세요.`,
          });
        }
        return;
      }
      if (!isCurrentSchedule(requestScheduleKey)) return;
      setRows(toOperationRows(nextRows));
      onNotice({
        kind: "success",
        text: reopening
          ? "등록 마감을 취소했습니다. 가번호 등록을 다시 진행할 수 있습니다."
          : nextStatus.autoAssignedAbsenteeCount > 0
            ? `가번호 등록을 마감하고 결시자 ${nextStatus.autoAssignedAbsenteeCount}명의 가번호를 자동 부여했습니다.`
            : "가번호 등록 작업을 마감했습니다.",
      });
    } catch (reason) {
      if (isCurrentSchedule(requestScheduleKey)) {
        onNotice({
          kind: "error",
          text:
            reason instanceof Error
              ? reason.message
              : reopening
                ? "등록 마감을 취소하지 못했습니다."
                : "가번호 등록을 마감하지 못했습니다.",
        });
      }
    } finally {
      statusChangePendingRef.current = false;
      if (isCurrentSchedule(requestScheduleKey)) setClosing(false);
    }
  }

  async function refresh(clearNotice = true) {
    if (refreshing) return false;
    const requestScheduleKey = scheduleKey;
    setRefreshing(true);
    if (clearNotice) onNotice(null);
    try {
      const [nextRows, nextStatus] = await Promise.all([
        fetchOperationRoster(token, schedule),
        fetchPseudonymOperationStatus(token, operationScope(schedule, examName)),
      ]);
      if (!isCurrentSchedule(requestScheduleKey)) return false;
      setRows(toOperationRows(nextRows));
      setStatus(nextStatus);
      setStatusLoaded(true);
      return true;
    } catch (reason) {
      if (isCurrentSchedule(requestScheduleKey)) {
        onNotice({
          kind: "error",
          text: reason instanceof Error ? reason.message : "교시 수험생 데이터를 다시 불러오지 못했습니다.",
        });
      }
      return false;
    } finally {
      if (isCurrentSchedule(requestScheduleKey)) setRefreshing(false);
    }
  }

  async function download(query: PseudonymRosterExportQuery) {
    if (exporting) return;
    const requestScheduleKey = scheduleKey;
    setExporting(true);
    try {
      await downloadPseudonymRosterExcel(
        token,
        {
          examName,
          examDate: schedule.date,
          examTime: schedule.time,
          periodName: schedule.periodName,
          admissionName: schedule.admissionName,
          query,
        },
        `${safeFileName(`${schedule.admissionName}_${schedule.date}_${schedule.periodName}_가번호 등록 현황`)}.xlsx`,
      );
      if (isCurrentSchedule(requestScheduleKey)) {
        onNotice({
          kind: "success",
          text: "현재 그리드의 필터·정렬 조건으로 엑셀 파일을 다운로드했습니다.",
        });
      }
    } catch (reason) {
      if (isCurrentSchedule(requestScheduleKey)) {
        onNotice({
          kind: "error",
          text: reason instanceof Error ? reason.message : "엑셀 파일을 생성하지 못했습니다.",
        });
      }
    } finally {
      if (isCurrentSchedule(requestScheduleKey)) setExporting(false);
    }
  }

  return {
    rows,
    status,
    statusLoaded,
    closing,
    refreshing,
    exporting,
    clearCandidateHistory: (candidateId: number, mode: "LABEL" | "ASSIGNMENT", clearedPreassigned: boolean) => {
      setRows((current) =>
        current.map((row) =>
          row.candidate.id !== candidateId
            ? row
            : {
                candidate:
                  mode === "LABEL"
                    ? { ...row.candidate, lastPrintedAt: null }
                    : {
                        ...row.candidate,
                        assignedNumber: null,
                        assignmentMode: null,
                        assignedAt: null,
                        ...(clearedPreassigned ? { preassignedNumber: null, preassignedAvailable: false } : {}),
                      },
                assignment: mode === "LABEL" ? row.assignment : null,
              },
        ),
      );
    },
    addRow,
    finish,
    reopen,
    refresh,
    download,
    isCurrentSchedule,
  };
}
