import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState, type FormEvent } from "react";
import { fetchCandidates, type CandidateRecord } from "../../shared/api/candidates";
import { fetchLabelTemplates, type LabelTemplateSummary } from "../../shared/api/label-templates";
import {
  fetchPseudonymSetting,
  updatePseudonymSetting,
  type PseudonymAssignmentMethod,
  type PseudonymSetting,
} from "../../shared/api/pseudonyms";
import { ApiError } from "../../shared/api/client";
import { ToastNotice } from "../../shared/components/ToastNotice";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import { BulkRangeModal } from "./BulkRangeModal";
import { AssignmentMethodSection, OperationPolicySection, ScheduleRangeSection } from "./SystemSettingsSections";
import {
  applyBulkRangeSettings,
  buildScheduleRanges,
  configuredRangeBounds,
  createSettingsSnapshot,
  formatRangeNumber,
  hasInvalidRange,
  parseRangeNumberInput,
  scheduleIdentity,
  toSettingRanges,
  totalRangeCapacity,
  updateRangeStart,
  type BulkRangeCriterion,
  type BulkRangeMode,
  type RangeDraft,
} from "./system-settings-domain";

export { applyBulkRangeSettings, buildScheduleRanges } from "./system-settings-domain";
export type { BulkRangeCriterion, BulkRangeMode, RangeDraft } from "./system-settings-domain";

const DEFAULT_EXAM_NAME = import.meta.env.VITE_DEFAULT_EXAM_NAME || "2026년도 자격시험";

export interface SystemSettingsPageHandle {
  save(): Promise<boolean>;
}

interface SystemSettingsPageProps {
  token: string;
  admissionName: string;
  embedded?: boolean;
  onDirtyChange?(dirty: boolean): void;
  onSaveStateChange?(state: { canSave: boolean; saving: boolean }): void;
  onSaved?(setting: PseudonymSetting): void;
}

export const SystemSettingsPage = forwardRef<SystemSettingsPageHandle, SystemSettingsPageProps>(
  function SystemSettingsPage(
    { token, admissionName, embedded = false, onDirtyChange, onSaveStateChange, onSaved },
    ref,
  ) {
    const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
    const [assignmentMethod, setAssignmentMethod] = useState<PseudonymAssignmentMethod>("DRAW");
    const [ranges, setRanges] = useState<RangeDraft[]>([]);
    const [fallbackRange, setFallbackRange] = useState({ start: 1001, end: 1999, displayWidth: 4 });
    const [settingVersion, setSettingVersion] = useState(1);
    const [autoDrawEnabled, setAutoDrawEnabled] = useState(false);
    const [autoDrawDelaySeconds, setAutoDrawDelaySeconds] = useState(3);
    const [printPreassignedLabel, setPrintPreassignedLabel] = useState(true);
    const [labelTemplateId, setLabelTemplateId] = useState<number | null>(null);
    const [labelTemplates, setLabelTemplates] = useState<LabelTemplateSummary[]>([]);
    const [autoAssignAbsenteesOnClose, setAutoAssignAbsenteesOnClose] = useState(false);
    const [deleteAbsenteeInfoOnReopen, setDeleteAbsenteeInfoOnReopen] = useState(false);
    const [useCandidatePhotos, setUseCandidatePhotos] = useState(true);
    const [enableBulkDraw, setEnableBulkDraw] = useState(false);
    const [showAttendanceSelection, setShowAttendanceSelection] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkMode, setBulkMode] = useState<BulkRangeMode>("SAME_START");
    const [bulkStart, setBulkStart] = useState("1001");
    const [bulkCriteria, setBulkCriteria] = useState<BulkRangeCriterion[]>([]);
    const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
    const [requiresInitialSave, setRequiresInitialSave] = useState(false);
    const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

    const applySetting = useCallback((setting: PseudonymSetting, rows: CandidateRecord[]) => {
      const nextRanges = buildScheduleRanges(rows, setting);
      setRequiresInitialSave(
        setting.version === 0 ||
          setting.ranges.length !== nextRanges.length ||
          nextRanges.some((range) => {
            const saved = setting.ranges.find((item) => scheduleIdentity(item) === scheduleIdentity(range));
            return (
              !saved ||
              saved.rangeStart !== range.rangeStart ||
              saved.rangeEnd !== range.rangeEnd ||
              (saved.displayWidth ?? setting.displayWidth) !== range.displayWidth
            );
          }),
      );
      setCandidates(rows);
      setSettingVersion(setting.version);
      setAssignmentMethod(setting.assignmentMethod);
      setAutoDrawEnabled(setting.autoDrawEnabled);
      setAutoDrawDelaySeconds(setting.autoDrawDelaySeconds);
      setFallbackRange({
        start: setting.rangeStart,
        end: setting.rangeEnd,
        displayWidth:
          setting.displayWidth ?? Math.max(String(setting.rangeStart).length, String(setting.rangeEnd).length),
      });
      setRanges(nextRanges);
      setPrintPreassignedLabel(setting.printPreassignedLabel);
      setLabelTemplateId(setting.labelTemplateId ?? null);
      setAutoAssignAbsenteesOnClose(setting.autoAssignAbsenteesOnClose);
      setDeleteAbsenteeInfoOnReopen(setting.deleteAbsenteeInfoOnReopen);
      setUseCandidatePhotos(setting.useCandidatePhotos);
      setEnableBulkDraw(setting.enableBulkDraw);
      setShowAttendanceSelection(setting.showAttendanceSelection ?? true);
      setSavedSnapshot(
        createSettingsSnapshot({
          assignmentMethod: setting.assignmentMethod,
          ranges: nextRanges,
          autoDrawEnabled: setting.autoDrawEnabled,
          autoDrawDelaySeconds: setting.autoDrawDelaySeconds,
          printPreassignedLabel: setting.printPreassignedLabel,
          labelTemplateId: setting.labelTemplateId ?? null,
          autoAssignAbsenteesOnClose: setting.autoAssignAbsenteesOnClose,
          deleteAbsenteeInfoOnReopen: setting.deleteAbsenteeInfoOnReopen,
          useCandidatePhotos: setting.useCandidatePhotos,
          enableBulkDraw: setting.enableBulkDraw,
          showAttendanceSelection: setting.showAttendanceSelection ?? true,
        }),
      );
    }, []);
    const load = useCallback(async () => {
      setLoading(true);
      setNotice(null);
      try {
        const [setting, rows, labelTemplateResult] = await Promise.all([
          fetchPseudonymSetting(token, DEFAULT_EXAM_NAME, admissionName),
          fetchCandidates(token),
          fetchLabelTemplates(token),
        ]);
        setLabelTemplates(labelTemplateResult.templates.filter((template) => template.active));
        applySetting(
          setting,
          rows.filter((candidate) => candidate.admission.trim() === admissionName),
        );
      } catch (reason) {
        setNotice({ kind: "error", text: messageOf(reason, "시스템 설정을 불러오지 못했습니다.") });
      } finally {
        setLoading(false);
      }
    }, [admissionName, applySetting, token]);

    useEffect(() => {
      void load();
    }, [load]);

    useEscapeKey(bulkOpen, () => setBulkOpen(false));

    const rangeCapacity = useMemo(() => totalRangeCapacity(ranges), [ranges]);
    const invalidRange = hasInvalidRange(ranges);
    const currentSnapshot = useMemo(
      () =>
        createSettingsSnapshot({
          assignmentMethod,
          ranges,
          autoDrawEnabled,
          autoDrawDelaySeconds,
          printPreassignedLabel,
          labelTemplateId,
          autoAssignAbsenteesOnClose,
          deleteAbsenteeInfoOnReopen,
          useCandidatePhotos,
          enableBulkDraw,
          showAttendanceSelection,
        }),
      [
        assignmentMethod,
        ranges,
        autoDrawEnabled,
        autoDrawDelaySeconds,
        printPreassignedLabel,
        labelTemplateId,
        autoAssignAbsenteesOnClose,
        deleteAbsenteeInfoOnReopen,
        useCandidatePhotos,
        enableBulkDraw,
        showAttendanceSelection,
      ],
    );
    const dirty = savedSnapshot !== null && (requiresInitialSave || savedSnapshot !== currentSnapshot);

    useEffect(() => {
      onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);
    useEffect(() => {
      onSaveStateChange?.({ canSave: dirty && !invalidRange && !saving, saving });
    }, [dirty, invalidRange, onSaveStateChange, saving]);

    useImperativeHandle(ref, () => ({ save: persistSettings }));

    async function persistSettings(): Promise<boolean> {
      if (invalidRange || saving || !dirty) return !dirty && !invalidRange;
      setSaving(true);
      setNotice(null);
      const configuredRanges = ranges;
      const { rangeStart, rangeEnd } = configuredRangeBounds(configuredRanges, fallbackRange);
      try {
        const setting = await updatePseudonymSetting(token, {
          examName: DEFAULT_EXAM_NAME,
          admissionName,
          expectedVersion: settingVersion,
          rangeStart,
          rangeEnd,
          displayWidth: configuredRanges.length
            ? Math.max(...configuredRanges.map((range) => range.displayWidth ?? String(range.rangeEnd).length))
            : fallbackRange.displayWidth,
          assignmentMethod,
          autoDrawEnabled,
          autoDrawDelaySeconds,
          printPreassignedLabel,
          labelTemplateId,
          autoAssignAbsenteesOnClose,
          deleteAbsenteeInfoOnReopen,
          useCandidatePhotos,
          enableBulkDraw,
          showAttendanceSelection,
          ranges: toSettingRanges(configuredRanges),
        });
        applySetting(setting, candidates);
        onSaved?.(setting);
        setNotice({ kind: "success", text: "시스템 설정을 저장했습니다." });
        return true;
      } catch (reason) {
        const conflictMessage =
          reason instanceof ApiError && reason.status === 409
            ? `${messageOf(reason, "다른 관리자가 먼저 설정을 변경했습니다.")} 새로고침하여 최신 설정을 확인해 주세요.`
            : messageOf(reason, "시스템 설정을 저장하지 못했습니다.");
        setNotice({ kind: "error", text: conflictMessage });
        return false;
      } finally {
        setSaving(false);
      }
    }

    function submitSettings(event: FormEvent) {
      event.preventDefault();
      void persistSettings();
    }

    function changeRangeStart(index: number, rawValue: string) {
      const parsed = parseRangeNumberInput(rawValue);
      setRanges((current) => updateRangeStart(current, index, parsed.value, parsed.displayWidth));
    }

    function openBulkSettings() {
      const firstRange = ranges[0];
      setBulkStart(
        firstRange
          ? formatRangeNumber(firstRange.rangeStart, firstRange.displayWidth)
          : formatRangeNumber(fallbackRange.start, fallbackRange.displayWidth),
      );
      setBulkMode("SAME_START");
      setBulkCriteria([]);
      setBulkOpen(true);
    }

    function updateBulkCriterion(index: number, value: string) {
      if (!value) {
        setBulkCriteria((current) => current.slice(0, index));
        return;
      }
      setBulkCriteria((current) => [...current.slice(0, index), value as BulkRangeCriterion]);
    }

    function applyBulkSettings() {
      const parsed = parseRangeNumberInput(bulkStart);
      if (parsed.value < 1 || (bulkMode === "CONTINUOUS" && !bulkCriteria.length)) return;
      setRanges((current) =>
        applyBulkRangeSettings(current, parsed.value, bulkMode, bulkCriteria, parsed.displayWidth),
      );
      setBulkOpen(false);
    }

    function refreshSettings() {
      if (
        dirty &&
        !window.confirm("저장하지 않은 변경 내용이 있습니다. 새로고침하면 변경 내용이 사라집니다. 계속할까요?")
      )
        return;
      void load();
    }

    if (loading)
      return (
        <section className={`admin-standard-view system-settings-view ${embedded ? "embedded" : ""}`}>
          <div className="admin-view-loading">{admissionName} 설정을 불러오고 있습니다.</div>
        </section>
      );

    return (
      <section className={`admin-standard-view system-settings-view ${embedded ? "embedded" : ""}`}>
        <form onSubmit={submitSettings}>
          {notice && <ToastNotice notice={notice} onClose={() => setNotice(null)} />}
          <div className="system-settings-content">
            <div className="system-settings-top-grid">
              <AssignmentMethodSection
                assignmentMethod={assignmentMethod}
                onAssignmentMethodChange={(method) => {
                  setAssignmentMethod(method);
                  if (method !== "DRAW") setEnableBulkDraw(false);
                }}
                autoDrawEnabled={autoDrawEnabled}
                onAutoDrawEnabledChange={setAutoDrawEnabled}
                autoDrawDelaySeconds={autoDrawDelaySeconds}
                onAutoDrawDelaySecondsChange={setAutoDrawDelaySeconds}
                printPreassignedLabel={printPreassignedLabel}
                onPrintPreassignedLabelChange={setPrintPreassignedLabel}
                labelTemplateId={labelTemplateId}
                labelTemplates={labelTemplates}
                onLabelTemplateIdChange={setLabelTemplateId}
              />
              <OperationPolicySection
                showAttendanceSelection={showAttendanceSelection}
                onShowAttendanceSelectionChange={setShowAttendanceSelection}
                assignmentMethod={assignmentMethod}
                autoAssignAbsenteesOnClose={autoAssignAbsenteesOnClose}
                onAutoAssignAbsenteesOnCloseChange={setAutoAssignAbsenteesOnClose}
                deleteAbsenteeInfoOnReopen={deleteAbsenteeInfoOnReopen}
                onDeleteAbsenteeInfoOnReopenChange={setDeleteAbsenteeInfoOnReopen}
                useCandidatePhotos={useCandidatePhotos}
                onUseCandidatePhotosChange={setUseCandidatePhotos}
                enableBulkDraw={enableBulkDraw}
                onEnableBulkDrawChange={setEnableBulkDraw}
              />
            </div>

            {(assignmentMethod === "DRAW" || assignmentMethod === "SEQUENTIAL" || assignmentMethod === "MATCHING") && (
              <ScheduleRangeSection
                assignmentMethod={assignmentMethod}
                ranges={ranges}
                rangeCapacity={rangeCapacity}
                loading={loading}
                onRefresh={refreshSettings}
                onOpenBulk={openBulkSettings}
                onRangeStartChange={changeRangeStart}
              />
            )}
          </div>
        </form>

        {bulkOpen && (
          <BulkRangeModal
            bulkStart={bulkStart}
            onBulkStartChange={setBulkStart}
            bulkMode={bulkMode}
            onBulkModeChange={setBulkMode}
            bulkCriteria={bulkCriteria}
            onBulkCriterionChange={updateBulkCriterion}
            onClose={() => setBulkOpen(false)}
            onApply={applyBulkSettings}
          />
        )}
      </section>
    );
  },
);

function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}
