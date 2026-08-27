import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchOperationRoster, type Examinee, type OperationSchedule } from "../../shared/api/examinees";
import {
  closePseudonymOperation,
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
    if (closing || status.closed) return;
    const requestScheduleKey = scheduleKey;
    setClosing(true);
    onNotice(null);
    try {
      const nextStatus = await closePseudonymOperation(token, operationScope(schedule, examName));
      const nextRows = await fetchOperationRoster(token, schedule);
      if (!isCurrentSchedule(requestScheduleKey)) return;
      setStatus(nextStatus);
      setRows(toOperationRows(nextRows));
      onClosed();
      onNotice({
        kind: "success",
        text:
          nextStatus.autoAssignedAbsenteeCount > 0
            ? `가번호 등록을 마감하고 결시자 ${nextStatus.autoAssignedAbsenteeCount}명의 가번호를 자동 부여했습니다.`
            : "가번호 등록 작업을 마감했습니다.",
      });
    } catch (reason) {
      if (isCurrentSchedule(requestScheduleKey)) {
        onNotice({
          kind: "error",
          text: reason instanceof Error ? reason.message : "가번호 등록을 마감하지 못했습니다.",
        });
      }
    } finally {
      if (isCurrentSchedule(requestScheduleKey)) setClosing(false);
    }
  }

  async function refresh() {
    if (refreshing) return;
    const requestScheduleKey = scheduleKey;
    setRefreshing(true);
    onNotice(null);
    try {
      const [nextRows, nextStatus] = await Promise.all([
        fetchOperationRoster(token, schedule),
        fetchPseudonymOperationStatus(token, operationScope(schedule, examName)),
      ]);
      if (!isCurrentSchedule(requestScheduleKey)) return;
      setRows(toOperationRows(nextRows));
      setStatus(nextStatus);
      setStatusLoaded(true);
    } catch (reason) {
      if (isCurrentSchedule(requestScheduleKey)) {
        onNotice({
          kind: "error",
          text: reason instanceof Error ? reason.message : "교시 수험생 데이터를 다시 불러오지 못했습니다.",
        });
      }
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
    addRow,
    finish,
    refresh,
    download,
    isCurrentSchedule,
  };
}
