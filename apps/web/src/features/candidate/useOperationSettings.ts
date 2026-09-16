import { useEffect, useState } from "react";
import type { OperationSchedule } from "../../shared/api/examinees";
import {
  fetchPseudonymSetting,
  type AssignmentMode,
  type PseudonymSetting,
  type PseudonymAssignmentMethod,
  type PseudonymTimeRange,
} from "../../shared/api/pseudonyms";

const DEFAULT_RANGE = { start: 1001, end: 1999 };

export function assignmentMethodToOperationMode(method: PseudonymAssignmentMethod): AssignmentMode {
  if (method === "DRAW") return "RANDOM";
  if (method === "SEQUENTIAL") return "SEQUENTIAL";
  if (method === "MATCHING") return "MANUAL";
  return "PREASSIGNED";
}

export function useOperationSettings(token: string, examName: string, schedule: OperationSchedule, resetKey: string) {
  const [selectedMode, setSelectedMode] = useState<AssignmentMode>("RANDOM");
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [configuredRanges, setConfiguredRanges] = useState<PseudonymTimeRange[]>([]);
  const [useCandidatePhotos, setUseCandidatePhotos] = useState(true);
  const [autoDrawEnabled, setAutoDrawEnabled] = useState(false);
  const [autoDrawDelaySeconds, setAutoDrawDelaySeconds] = useState(3);
  const [printPreassignedLabel, setPrintPreassignedLabel] = useState(true);
  const [autoAssignAbsenteesOnClose, setAutoAssignAbsenteesOnClose] = useState(false);
  const [deleteAbsenteeInfoOnReopen, setDeleteAbsenteeInfoOnReopen] = useState(false);
  const [labelPrintDefaults, setLabelPrintDefaults] = useState<PseudonymSetting["labelPrintDefaults"]>(null);
  const [settingLoaded, setSettingLoaded] = useState(false);

  useEffect(() => {
    setSelectedMode("RANDOM");
    setRange(DEFAULT_RANGE);
    setConfiguredRanges([]);
    setUseCandidatePhotos(true);
    setAutoDrawEnabled(false);
    setAutoDrawDelaySeconds(3);
    setPrintPreassignedLabel(true);
    setAutoAssignAbsenteesOnClose(false);
    setDeleteAbsenteeInfoOnReopen(false);
    setSettingLoaded(false);
    setLabelPrintDefaults(null);
  }, [resetKey]);

  useEffect(() => {
    let active = true;
    setSettingLoaded(false);
    void fetchPseudonymSetting(token, examName, schedule.admissionName)
      .then((setting) => {
        if (!active) return;
        const selectedScheduleRange = setting.ranges.find(
          (item) =>
            item.date === schedule.date &&
            item.time === schedule.time &&
            item.period === schedule.periodName &&
            item.admission === schedule.admissionName,
        );
        setRange(
          selectedScheduleRange
            ? { start: selectedScheduleRange.rangeStart, end: selectedScheduleRange.rangeEnd }
            : { start: setting.rangeStart, end: setting.rangeEnd },
        );
        setConfiguredRanges(setting.ranges);
        setUseCandidatePhotos(setting.useCandidatePhotos);
        setAutoDrawEnabled(setting.autoDrawEnabled);
        setAutoDrawDelaySeconds(setting.autoDrawDelaySeconds);
        setPrintPreassignedLabel(setting.printPreassignedLabel);
        setLabelPrintDefaults(setting.labelPrintDefaults ?? null);
        setAutoAssignAbsenteesOnClose(setting.autoAssignAbsenteesOnClose);
        setDeleteAbsenteeInfoOnReopen(setting.deleteAbsenteeInfoOnReopen);
        setSelectedMode(assignmentMethodToOperationMode(setting.assignmentMethod));
        setSettingLoaded(true);
      })
      .catch(() => {
        /* 설정을 확인하지 못하면 프린터 설정 진입을 노출하지 않습니다. */
      });
    return () => {
      active = false;
    };
  }, [token, examName, schedule]);

  return {
    selectedMode,
    range,
    configuredRanges,
    useCandidatePhotos,
    autoDrawEnabled,
    autoDrawDelaySeconds,
    printPreassignedLabel,
    labelPrintDefaults,
    autoAssignAbsenteesOnClose,
    deleteAbsenteeInfoOnReopen,
    settingLoaded,
    setRange,
  };
}
