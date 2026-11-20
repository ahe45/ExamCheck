import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { fetchCandidates, type CandidateRecord } from "../../shared/api/candidates";
import { fetchLabelTemplates, type LabelTemplateSummary } from "../../shared/api/label-templates";
import {
  fetchPseudonymSetting,
  updatePseudonymSetting,
  updatePseudonymSettingsBatch,
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
type EditableSetting = Omit<PseudonymSetting, "id">;

export interface SystemSettingsPageHandle {
  save(): Promise<boolean>;
}

export interface SettingsScope {
  key: string;
  label: string;
}

interface SystemSettingsPageProps {
  token: string;
  admissionName: string;
  scopeLabel?: string;
  batchScopes?: readonly SettingsScope[];
  embedded?: boolean;
  onDirtyChange?(dirty: boolean): void;
  onSaveStateChange?(state: { canSave: boolean; saving: boolean }): void;
  onSaved?(settings: PseudonymSetting[]): void;
}

export const SystemSettingsPage = forwardRef<SystemSettingsPageHandle, SystemSettingsPageProps>(
  function SystemSettingsPage(
    { token, admissionName, scopeLabel, batchScopes, embedded = false, onDirtyChange, onSaveStateChange, onSaved },
    ref,
  ) {
    const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
    const [assignmentMethod, setAssignmentMethod] = useState<PseudonymAssignmentMethod>("DRAW");
    const [ranges, setRanges] = useState<RangeDraft[]>([]);
    const [savedSettings, setSavedSettings] = useState<EditableSetting[]>([]);
    const [autoDrawEnabled, setAutoDrawEnabled] = useState(false);
    const [autoDrawDelaySeconds, setAutoDrawDelaySeconds] = useState(3);
    const [printPreassignedLabel, setPrintPreassignedLabel] = useState(true);
    const [labelTemplateId, setLabelTemplateId] = useState<number | null>(null);
    const [labelTemplates, setLabelTemplates] = useState<LabelTemplateSummary[] | null>([]);
    const [autoAssignAbsenteesOnClose, setAutoAssignAbsenteesOnClose] = useState(false);
    const [deleteAbsenteeInfoOnReopen, setDeleteAbsenteeInfoOnReopen] = useState(false);
    const [useCandidatePhotos, setUseCandidatePhotos] = useState(true);
    const [enableBulkDraw, setEnableBulkDraw] = useState(false);
    const [showAttendanceSelection, setShowAttendanceSelection] = useState(true);
    const viewRef = useRef<HTMLElement>(null);
    const [useAnswerSheet, setUseAnswerSheet] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const saveInProgress = useRef(false);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkMode, setBulkMode] = useState<BulkRangeMode>("SAME_START");
    const [bulkStart, setBulkStart] = useState("1001");
    const [bulkCriteria, setBulkCriteria] = useState<BulkRangeCriterion[]>([]);
    const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
    const [requiresInitialSave, setRequiresInitialSave] = useState(false);
    const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

    useLayoutEffect(() => {
      const view = viewRef.current;
      if (!embedded || loading || !view) return;
      // Keep the no-scrollbar content width; the scrollbar fits in the existing right padding.
      const syncScrollbarWidth = () => {
        view.style.setProperty("--settings-scrollbar-width", `${Math.max(0, view.offsetWidth - view.clientWidth)}px`);
      };
      syncScrollbarWidth();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(syncScrollbarWidth);
      observer.observe(view);
      return () => observer.disconnect();
    }, [embedded, loading, assignmentMethod]);

    const applySettings = useCallback(
      (settings: EditableSetting[], rows: CandidateRecord[]) => {
        const [setting] = settings;
        const rowsByScope = new Map<string, CandidateRecord[]>();
        for (const row of rows) {
          const key = (row.operationScope ?? row.admission).trim();
          const group = rowsByScope.get(key);
          if (group) group.push(row);
          else rowsByScope.set(key, [row]);
        }
        const scopes = settings.map((item) => ({
          setting: item,
          ranges: buildScheduleRanges(rowsByScope.get(item.admissionName) ?? [], item),
        }));
        const nextRanges = scopes.flatMap(({ setting: item, ranges }) =>
          batchScopes ? ranges.map((range) => ({ ...range, scopeKey: item.admissionName })) : ranges,
        );
        setRequiresInitialSave(
          scopes.some(
            ({ setting: item, ranges }) =>
              settingSnapshot(item, []) !== settingSnapshot(setting, []) || needsRangeSave(item, ranges),
          ),
        );
        setCandidates(rows);
        setSavedSettings(settings);
        setAssignmentMethod(setting.assignmentMethod);
        setAutoDrawEnabled(setting.autoDrawEnabled);
        setAutoDrawDelaySeconds(setting.autoDrawDelaySeconds);
        setRanges(nextRanges);
        setPrintPreassignedLabel(setting.printPreassignedLabel);
        setLabelTemplateId(setting.labelTemplateId ?? null);
        setAutoAssignAbsenteesOnClose(setting.autoAssignAbsenteesOnClose);
        setDeleteAbsenteeInfoOnReopen(setting.deleteAbsenteeInfoOnReopen);
        setUseCandidatePhotos(setting.useCandidatePhotos);
        setEnableBulkDraw(setting.enableBulkDraw);
        setShowAttendanceSelection(setting.showAttendanceSelection ?? true);
        setUseAnswerSheet(setting.useAnswerSheet ?? false);
        setSavedSnapshot(settingSnapshot(setting, nextRanges));
      },
      [batchScopes],
    );
    const load = useCallback(async () => {
      setLoading(true);
      setNotice(null);
      try {
        const keys = batchScopes?.map(({ key }) => key) ?? [admissionName];
        const [settings, rows, labelTemplateResult] = await Promise.all([
          Promise.all(keys.map((key) => loadEditableSetting(token, key))),
          fetchCandidates(token),
          fetchLabelTemplates(token).catch(() => null),
        ]);
        setLabelTemplates(labelTemplateResult?.templates.filter((template) => template.active) ?? null);
        applySettings(settings, rows);
      } catch (reason) {
        setSavedSnapshot(null);
        setNotice({ kind: "error", text: messageOf(reason, "시스템 설정을 불러오지 못했습니다.") });
      } finally {
        setLoading(false);
      }
    }, [admissionName, applySettings, batchScopes, token]);

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
          useAnswerSheet,
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
        useAnswerSheet,
      ],
    );
    const dirty =
      savedSnapshot !== null && (savedSnapshot !== currentSnapshot || (!batchScopes && requiresInitialSave));
    const canSave = savedSnapshot !== null && !loading && !saving && !invalidRange && (dirty || requiresInitialSave);
    const scopeLabels = batchScopes ? new Map(batchScopes.map(({ key, label }) => [key, label])) : undefined;

    useEffect(() => {
      onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);
    useEffect(() => {
      onSaveStateChange?.({ canSave, saving });
    }, [canSave, onSaveStateChange, saving]);

    useImperativeHandle(ref, () => ({ save: persistSettings }));

    async function persistSettings(): Promise<boolean> {
      if (saveInProgress.current) return false;
      if (!canSave) return !dirty && !invalidRange;
      saveInProgress.current = true;
      setSaving(true);
      setNotice(null);
      try {
        const inputs = savedSettings.map((setting) => {
          const configuredRanges = batchScopes
            ? ranges.filter((range) => range.scopeKey === setting.admissionName)
            : ranges;
          const { rangeStart, rangeEnd } = configuredRangeBounds(configuredRanges, {
            start: setting.rangeStart,
            end: setting.rangeEnd,
          });
          return {
            examName: DEFAULT_EXAM_NAME,
            admissionName: setting.admissionName,
            expectedVersion: setting.version,
            rangeStart,
            rangeEnd,
            displayWidth: configuredRanges.length
              ? Math.max(...configuredRanges.map((range) => range.displayWidth ?? String(range.rangeEnd).length))
              : (setting.displayWidth ?? Math.max(String(setting.rangeStart).length, String(setting.rangeEnd).length)),
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
            useAnswerSheet,
            ranges: toSettingRanges(configuredRanges),
          };
        });
        const settings = batchScopes
          ? await updatePseudonymSettingsBatch(token, inputs)
          : [await updatePseudonymSetting(token, inputs[0])];
        applySettings(settings, candidates);
        onSaved?.(settings);
        setNotice({
          kind: "success",
          text: batchScopes ? `${settings.length}개 항목의 설정을 저장했습니다.` : "시스템 설정을 저장했습니다.",
        });
        return true;
      } catch (reason) {
        const conflictMessage =
          reason instanceof ApiError && reason.status === 409
            ? `${messageOf(reason, "다른 관리자가 먼저 설정을 변경했습니다.")} ${batchScopes ? "시스템 설정 목록을 새로고침한 뒤 일괄 설정을 다시 열어 주세요." : "새로고침하여 최신 설정을 확인해 주세요."}`
            : messageOf(reason, "시스템 설정을 저장하지 못했습니다.");
        setNotice({ kind: "error", text: conflictMessage });
        return false;
      } finally {
        saveInProgress.current = false;
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
      const [setting] = savedSettings;
      setBulkStart(
        firstRange
          ? formatRangeNumber(firstRange.rangeStart, firstRange.displayWidth)
          : formatRangeNumber(setting?.rangeStart ?? 1001, setting?.displayWidth ?? 4),
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
          <div className="admin-view-loading">
            {batchScopes ? "전체 항목의" : (scopeLabel ?? admissionName)} 설정을 불러오고 있습니다.
          </div>
        </section>
      );

    return (
      <section ref={viewRef} className={`admin-standard-view system-settings-view ${embedded ? "embedded" : ""}`}>
        <form onSubmit={submitSettings}>
          {notice && <ToastNotice notice={notice} onClose={() => setNotice(null)} />}
          <fieldset className="system-settings-content" disabled={saving}>
            <div className="system-settings-top-grid">
              <AssignmentMethodSection
                useAnswerSheet={useAnswerSheet}
                onUseAnswerSheetChange={setUseAnswerSheet}
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
                scopeLabels={scopeLabels}
              />
            )}
          </fieldset>
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

async function loadEditableSetting(token: string, admissionName: string): Promise<EditableSetting> {
  try {
    return await fetchPseudonymSetting(token, DEFAULT_EXAM_NAME, admissionName);
  } catch (reason) {
    // The operation screen still treats missing persisted settings as unconfigured.
    if (!(reason instanceof ApiError && reason.status === 404)) throw reason;
    return {
      version: 0,
      examName: DEFAULT_EXAM_NAME,
      admissionName,
      rangeStart: 1001,
      rangeEnd: 1999,
      displayWidth: 4,
      nextSequence: 1001,
      assignmentMethod: "DRAW",
      autoDrawEnabled: false,
      autoDrawDelaySeconds: 3,
      printPreassignedLabel: true,
      labelTemplateId: null,
      autoAssignAbsenteesOnClose: false,
      deleteAbsenteeInfoOnReopen: false,
      useCandidatePhotos: true,
      enableBulkDraw: false,
      showAttendanceSelection: true,
      useAnswerSheet: false,
      ranges: [],
    };
  }
}

function settingSnapshot(setting: EditableSetting, ranges: RangeDraft[]) {
  return createSettingsSnapshot({ ...setting, labelTemplateId: setting.labelTemplateId ?? null, ranges });
}

function needsRangeSave(setting: EditableSetting, ranges: RangeDraft[]) {
  if (setting.version === 0 || setting.ranges.length !== ranges.length) return true;
  const savedBySchedule = new Map(setting.ranges.map((range) => [scheduleIdentity(range), range]));
  return ranges.some((range) => {
    const saved = savedBySchedule.get(scheduleIdentity(range));
    return (
      !saved ||
      saved.rangeStart !== range.rangeStart ||
      saved.rangeEnd !== range.rangeEnd ||
      (saved.displayWidth ?? setting.displayWidth) !== range.displayWidth
    );
  });
}
