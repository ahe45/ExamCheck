import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { AuthUser } from "../../shared/api/auth";
import { deleteCandidateHistory } from "../../shared/api/pseudonyms";
import type { OperationSchedule } from "../../shared/api/examinees";
import type { PrinterService } from "../printer/PrinterService";
import type { PrinterDevice, PrinterDiagnostic, PrinterMode } from "../printer/printer.types";
import { PrinterSetupPage } from "../setup/PrinterSetupPage";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import { ClientGridFilterLayer } from "../../shared/components/ClientDataGridControls";
import { useClientDataGrid } from "../../shared/hooks/useClientDataGrid";
import { createOperationRequestTarget, operationScheduleKey } from "./operation-request-guard";
import type { OperationNotice } from "./operation-candidate-state";
import { OperationDrawPopover } from "./OperationDrawPopover";
import { OperationHistoryResetModal } from "./OperationHistoryResetModal";
import { OperationConsoleHeader } from "./OperationConsoleHeader";
import {
  OperationFinishModal,
  OperationPrintModal,
  OperationScheduleMismatchModal,
  OperationSignatureModal,
} from "./OperationConsoleModals";
import { OperationControlPanel } from "./OperationControlPanel";
import { OperationRosterPanel } from "./OperationRosterPanel";
import {
  operationColumnsFor,
  operationRowValue,
  toRosterExportQuery,
  type OperationFieldKey,
  type OperationRow,
} from "./operation-view-model";
import { useOperationCandidateController } from "./useOperationCandidateController";
import { useOperationLabelPrint } from "./useOperationLabelPrint";
import { useOperationLookupAndPrint } from "./useOperationLookupAndPrint";
import { usePrinterConnectionCheck } from "./usePrinterConnectionCheck";
import { useOperationPrint } from "./useOperationPrint";
import { useOperationRoster } from "./useOperationRoster";
import { useOperationSettings } from "./useOperationSettings";

interface Props {
  token: string;
  user: AuthUser;
  systemProfile: DeveloperSettings;
  schedule: OperationSchedule;
  mode: PrinterMode;
  service: PrinterService;
  diagnostic: PrinterDiagnostic;
  printers: PrinterDevice[];
  selectedPrinterId: string | null;
  diagnosticBusy: boolean;
  onDiagnose(): Promise<void>;
  onSelectPrinter(printerId: string): void;
  onChangeSchedule(): void;
  onLogout(): void;
}

const DEFAULT_EXAM_NAME = import.meta.env.VITE_DEFAULT_EXAM_NAME || "2026년도 자격시험";
export function PseudonymAssignmentPage(props: Props) {
  const examineeInputRef = useRef<HTMLInputElement>(null);
  const candidatePreviewRef = useRef<HTMLElement | null>(null);
  const headerSettingsRef = useRef<HTMLDivElement | null>(null);
  const noticeSinkRef = useRef<(notice: OperationNotice | null) => void>(() => undefined);
  const emitNotice = useCallback((notice: OperationNotice | null) => noticeSinkRef.current(notice), []);
  const deletingHistoryRef = useRef(false);
  const printerRecheckRef = useRef(false);
  const [deletingHistory, setDeletingHistory] = useState(false);
  const [printerPageOpen, setPrinterPageOpen] = useState(false);
  const [drawPopoverPosition, setDrawPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  const [headerSettingsOpen, setHeaderSettingsOpen] = useState(false);
  const [historyResetOpen, setHistoryResetOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const currentScheduleKey = operationScheduleKey(props.schedule);
  const operationSettings = useOperationSettings(props.token, DEFAULT_EXAM_NAME, props.schedule, currentScheduleKey);
  const {
    selectedMode,
    range,
    configuredRanges,
    useCandidatePhotos,
    autoDrawEnabled,
    autoDrawDelaySeconds,
    printPreassignedLabel,
    autoAssignAbsenteesOnClose,
    settingLoaded,
    setRange,
  } = operationSettings;
  const labelPrintingEnabled = settingLoaded && selectedMode === "PREASSIGNED" && printPreassignedLabel;
  usePrinterConnectionCheck(labelPrintingEnabled, currentScheduleKey, props.onDiagnose);
  const operationRoster = useOperationRoster({
    token: props.token,
    examName: DEFAULT_EXAM_NAME,
    schedule: props.schedule,
    scheduleKey: currentScheduleKey,
    onNotice: emitNotice,
  });
  const {
    rows: operationRows,
    status: operationStatus,
    statusLoaded: operationStatusLoaded,
    closing: closingOperation,
    refreshing: rosterRefreshing,
    exporting: exportingExcel,
  } = operationRoster;
  const isCurrentSchedule = operationRoster.isCurrentSchedule;
  const rosterColumns = operationColumnsFor(labelPrintingEnabled);
  const rosterValueOf = useCallback(
    (row: OperationRow, key: OperationFieldKey) =>
      operationRowValue(row, key, {
        operationClosed: operationStatus.closed,
        labelPrintingEnabled,
      }),
    [labelPrintingEnabled, operationStatus.closed],
  );
  const rosterGrid = useClientDataGrid<OperationRow, OperationFieldKey>({
    rows: operationRows,
    valueOf: rosterValueOf,
    initialPageSize: 0,
    resetKey: `${currentScheduleKey}:${labelPrintingEnabled}`,
  });
  const candidateController = useOperationCandidateController({
    token: props.token,
    userRole: props.user.role,
    schedule: props.schedule,
    selectedMode,
    operationClosed: operationStatus.closed,
    operationStatusLoaded,
    configuredRanges,
    useCandidatePhotos,
    range,
    autoDrawEnabled: autoDrawEnabled && !historyResetOpen,
    autoDrawDelaySeconds,
    onRangeChange: setRange,
    onAssigned: operationRoster.addRow,
  });
  const {
    input,
    candidate,
    photoUrl,
    manualNumber,
    assignment,
    searching,
    assigning,
    notice,
    drawPopoverOpen,
    drawPreviewNumber,
    sequentialPreviewNumber,
    autoDrawRemainingMs,
    scheduleMismatch,
    canAssign,
    setInput,
    setManualNumber,
    setNotice,
    setDrawPopoverOpen,
    setScheduleMismatch,
    lookupExaminee,
    selectOperationRow,
    assign,
  } = candidateController;
  const operationLabelPrint = useOperationLabelPrint({
    token: props.token,
    userRole: props.user.role,
    schedule: props.schedule,
    scheduleKey: currentScheduleKey,
    candidate: candidate
      ? {
          ...candidate,
          lastPrintedAt:
            candidate.lastPrintedAt ||
            operationRows.find((row) => row.candidate.examineeNo === candidate.examineeNo)?.candidate.lastPrintedAt,
        }
      : null,
    assignment,
    labelPrintDefaults: operationSettings.labelPrintDefaults,
    service: props.service,
    diagnostic: props.diagnostic,
    isCurrentTarget: candidateController.isCurrentTarget,
    onNotice: setNotice,
  });
  const { printing } = operationLabelPrint;
  const canDeleteHistory = Boolean(
    candidate &&
    settingLoaded &&
    operationStatusLoaded &&
    props.user.role !== "VIEWER" &&
    !searching &&
    !assigning &&
    !printing &&
    !rosterRefreshing &&
    !closingOperation &&
    !historyResetOpen &&
    !deletingHistory &&
    (labelPrintingEnabled ? operationLabelPrint.alreadyPrinted : assignment),
  );
  const lookupAndPrint = useOperationLookupAndPrint({
    ready: settingLoaded,
    printing,
    labelPrintingEnabled,
    lookup: lookupExaminee,
    isCurrent: ({ candidate: found }) =>
      candidateController.isCurrentTarget(createOperationRequestTarget(found.examineeNo, props.schedule)),
    print: async (selection) => {
      await operationLabelPrint.print(selection);
      if (isCurrentSchedule(currentScheduleKey)) void operationRoster.refresh(false);
    },
  });
  const operationPrint = useOperationPrint({
    token: props.token,
    systemProfile: props.systemProfile,
    examName: DEFAULT_EXAM_NAME,
    schedule: props.schedule,
    scheduleKey: currentScheduleKey,
    rows: operationRows,
    statusLoaded: operationStatusLoaded,
    operationClosed: operationStatus.closed,
    isCurrentSchedule,
    onNotice: setNotice,
  });
  async function recheckPrinter() {
    if (printerRecheckRef.current || props.diagnosticBusy || printing || lookupAndPrint.busy) return;
    printerRecheckRef.current = true;
    const focusTarget = document.activeElement;
    try {
      await props.onDiagnose();
    } catch (reason) {
      if (isCurrentSchedule(currentScheduleKey))
        setNotice({
          kind: "error",
          text: reason instanceof Error ? reason.message : "프린터 연결을 확인하지 못했습니다.",
        });
    } finally {
      printerRecheckRef.current = false;
      if (
        isCurrentSchedule(currentScheduleKey) &&
        (document.activeElement === focusTarget || document.activeElement === document.body) &&
        !examineeInputRef.current?.closest("[inert]")
      )
        examineeInputRef.current?.focus();
    }
  }
  const {
    open: printModalOpen,
    templates: formTemplates,
    selectedTemplateCode,
    loading: templatesLoading,
    generating: generatingPdf,
    progress: printProgress,
    signatureFields,
    signatureNames,
  } = operationPrint;

  useLayoutEffect(() => {
    noticeSinkRef.current = setNotice;
  }, [setNotice]);

  const closeDrawPopover = useCallback(() => {
    setDrawPopoverOpen(false);
    examineeInputRef.current?.focus({ preventScroll: true });
    examineeInputRef.current?.select();
  }, [setDrawPopoverOpen]);

  useLayoutEffect(() => {
    if ((selectedMode === "SEQUENTIAL" || selectedMode === "MANUAL") && assignment && drawPopoverOpen)
      closeDrawPopover();
  }, [assignment, closeDrawPopover, drawPopoverOpen, selectedMode]);

  useEscapeKey(Boolean(rosterGrid.filterMenu), rosterGrid.closeFilter);
  useEscapeKey(drawPopoverOpen, closeDrawPopover);
  useEscapeKey(headerSettingsOpen, () => setHeaderSettingsOpen(false));
  useEscapeKey(closeConfirmOpen, () => {
    if (!closingOperation) setCloseConfirmOpen(false);
  });
  useEscapeKey(printModalOpen, () => {
    if (operationPrint.signatureOpen) {
      operationPrint.closeSignatures();
      return;
    }
    operationPrint.close();
  });
  useEscapeKey(Boolean(scheduleMismatch), () => setScheduleMismatch(null));

  useEffect(() => {
    setDrawPopoverPosition(null);
    setHeaderSettingsOpen(false);
    setCloseConfirmOpen(false);
    setPrinterPageOpen(false);
    setHistoryResetOpen(false);
  }, [currentScheduleKey]);

  useEffect(() => {
    if (!headerSettingsOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!headerSettingsRef.current?.contains(event.target as Node)) setHeaderSettingsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [headerSettingsOpen]);

  useLayoutEffect(() => {
    if (!drawPopoverOpen || !candidatePreviewRef.current) {
      setDrawPopoverPosition(null);
      return;
    }
    const preview = candidatePreviewRef.current;
    const updatePosition = () => {
      const rect = preview.getBoundingClientRect();
      setDrawPopoverPosition({
        left: Math.min(rect.right + 12, window.innerWidth - 732),
        top: Math.max(70, Math.min(rect.top, window.innerHeight - 650)),
      });
    };
    const scrollParent = preview.closest(".operator-control-panel");
    updatePosition();
    window.addEventListener("resize", updatePosition);
    scrollParent?.addEventListener("scroll", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      scrollParent?.removeEventListener("scroll", updatePosition);
    };
  }, [drawPopoverOpen, candidate]);

  async function search(event: FormEvent) {
    event.preventDefault();
    const field = event.currentTarget.querySelector<HTMLInputElement>("#operator-examinee-no");
    if (historyResetOpen || deletingHistoryRef.current) return;
    await lookupAndPrint.submit(input);
    // Leave the number selected so the next reader scan replaces it.
    if (field?.isConnected && document.activeElement === field) field.select();
  }

  function resetLookup() {
    candidateController.resetLookup();
    operationLabelPrint.reset();
  }

  async function deleteSelectedHistory() {
    if (!candidate || !canDeleteHistory || deletingHistoryRef.current) return;
    const selected = candidate;
    const requestScheduleKey = currentScheduleKey;
    deletingHistoryRef.current = true;
    setDeletingHistory(true);
    setNotice(null);
    try {
      const result = await deleteCandidateHistory(props.token, {
        examName: selected.examName,
        examDate: props.schedule.date,
        examTime: props.schedule.time,
        periodName: props.schedule.periodName,
        admissionName: props.schedule.admissionName,
        candidateRecordId: selected.id,
        examineeNo: selected.examineeNo,
        mode: labelPrintingEnabled ? "LABEL" : "ASSIGNMENT",
      });
      if (!isCurrentSchedule(requestScheduleKey)) return;
      operationRoster.clearCandidateHistory(selected.id, result.mode, result.clearedPreassigned);
      if (result.mode === "LABEL") operationLabelPrint.clearCandidateHistory(selected);
      resetLookup();
      const refreshed = await operationRoster.refresh(false);
      if (!isCurrentSchedule(requestScheduleKey)) return;
      setNotice(
        refreshed
          ? {
              kind: "success",
              text: `${selected.name} 수험생의 ${result.mode === "LABEL" ? "라벨 출력이력을" : "가번호를"} 삭제했습니다.`,
            }
          : { kind: "error", text: "이력은 삭제되었지만 목록을 불러오지 못했습니다. 새로고침해 주세요." },
      );
      examineeInputRef.current?.focus({ preventScroll: true });
    } catch (reason) {
      if (isCurrentSchedule(requestScheduleKey))
        setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "이력을 삭제하지 못했습니다." });
    } finally {
      deletingHistoryRef.current = false;
      setDeletingHistory(false);
    }
  }

  async function finishOperation() {
    await (operationStatus.closed ? operationRoster.reopen : operationRoster.finish)(() => {
      resetLookup();
      setCloseConfirmOpen(false);
    });
  }

  if (printerPageOpen) {
    return (
      <PrinterSetupPage
        mode={props.mode}
        token={props.token}
        user={props.user}
        service={props.service}
        diagnostic={props.diagnostic}
        printers={props.printers}
        selectedPrinterId={props.selectedPrinterId}
        busy={props.diagnosticBusy}
        onDiagnose={props.onDiagnose}
        onSelectPrinter={props.onSelectPrinter}
        onBack={() => setPrinterPageOpen(false)}
        onLogout={props.onLogout}
      />
    );
  }

  return (
    <div className="operator-console">
      <OperationConsoleHeader
        systemProfile={props.systemProfile}
        schedule={props.schedule}
        roomName={candidate?.roomName}
        candidateCount={operationRows.length}
        selectedMode={selectedMode}
        autoDrawEnabled={autoDrawEnabled}
        autoDrawDelaySeconds={autoDrawDelaySeconds}
        range={range}
        settingsOpen={headerSettingsOpen}
        settingsRef={headerSettingsRef}
        labelPrintingEnabled={labelPrintingEnabled}
        loginId={props.user.loginId}
        onChangeSchedule={props.onChangeSchedule}
        onToggleSettings={() => setHeaderSettingsOpen((current) => !current)}
        onOpenPrinter={() => {
          setHeaderSettingsOpen(false);
          setPrinterPageOpen(true);
        }}
        resetDisabled={
          deletingHistory ||
          !settingLoaded ||
          searching ||
          assigning ||
          printing ||
          lookupAndPrint.busy ||
          rosterRefreshing ||
          closingOperation ||
          props.user.role === "VIEWER"
        }
        onResetHistory={() => {
          setDrawPopoverOpen(false);
          setHistoryResetOpen(true);
          setHeaderSettingsOpen(false);
        }}
        onLogout={props.onLogout}
      />

      <div className="operator-console-body">
        <OperationControlPanel
          inputRef={examineeInputRef}
          previewRef={candidatePreviewRef}
          input={input}
          searching={searching}
          processing={lookupAndPrint.busy || printing || historyResetOpen || deletingHistory}
          searchReady={settingLoaded}
          notice={notice}
          candidate={candidate}
          useCandidatePhotos={useCandidatePhotos}
          photoUrl={photoUrl}
          selectedMode={selectedMode}
          assignment={assignment}
          onSearch={search}
          onInput={setInput}
          onReset={resetLookup}
          onCloseNotice={() => setNotice(null)}
        />

        <OperationRosterPanel
          rows={rosterGrid.filteredRows}
          allRows={operationRows}
          selectedExamineeNo={candidate?.examineeNo}
          columns={rosterColumns}
          context={{ operationClosed: operationStatus.closed, labelPrintingEnabled }}
          grid={{
            sort: rosterGrid.sort,
            filters: rosterGrid.filters,
            cycleSort: rosterGrid.cycleSort,
            openFilter: rosterGrid.openFilter,
          }}
          state={{
            canDeleteHistory,
            deletingHistory,
            operationStatusLoaded,
            operationClosed: operationStatus.closed,
            closingOperation,
            rosterRefreshing,
            exportingExcel,
            labelPrintingEnabled,
            printerDiagnostic: props.diagnostic,
            printerDiagnosticBusy: props.diagnosticBusy,
            assignment,
            printing: printing || lookupAndPrint.busy,
            labelAlreadyPrinted: operationLabelPrint.alreadyPrinted,
            labelCopies: operationLabelPrint.copies,
            labelCopiesValid: operationLabelPrint.copiesValid,
            labelTemplateName: operationSettings.labelPrintDefaults?.templateName,
          }}
          actions={{
            recheckPrinter: () => void recheckPrinter(),
            deleteHistory: () => void deleteSelectedHistory(),
            refresh: () => void operationRoster.refresh(),
            openCloseConfirm: () => setCloseConfirmOpen(true),
            openPrint: () => void operationPrint.show(),
            download: () =>
              void operationRoster.download(toRosterExportQuery(rosterGrid.filters, rosterGrid.sort, rosterColumns)),
            setLabelCopies: operationLabelPrint.setCopies,
            printLabel: () =>
              void operationLabelPrint.print().then(() => {
                if (isCurrentSchedule(currentScheduleKey)) void operationRoster.refresh(false);
              }),
            select: (examineeNo) => {
              if (!deletingHistoryRef.current && !lookupAndPrint.busy && !printing) selectOperationRow(examineeNo);
            },
          }}
        />
      </div>
      <ClientGridFilterLayer
        columns={rosterColumns}
        menu={rosterGrid.filterMenu}
        search={rosterGrid.filterSearch}
        draft={rosterGrid.filterDraft}
        options={rosterGrid.filterOptions}
        onSearch={rosterGrid.setFilterSearch}
        onToggleOption={rosterGrid.toggleFilterOption}
        onToggleVisible={rosterGrid.toggleVisibleFilterOptions}
        onClose={rosterGrid.closeFilter}
        onReset={rosterGrid.resetFilter}
        onApply={rosterGrid.applyFilter}
      />
      {historyResetOpen && (
        <OperationHistoryResetModal
          token={props.token}
          examName={DEFAULT_EXAM_NAME}
          schedule={props.schedule}
          labelPrintingEnabled={labelPrintingEnabled}
          onClose={() => setHistoryResetOpen(false)}
          onReset={async () => {
            resetLookup();
            operationLabelPrint.clearHistory();
            const refreshed = await operationRoster.refresh(false);
            if (!isCurrentSchedule(currentScheduleKey)) return;
            setHistoryResetOpen(false);
            setNotice(
              refreshed
                ? { kind: "success", text: "선택한 교시의 이력을 초기화했습니다." }
                : { kind: "error", text: "이력은 초기화되었지만 목록을 불러오지 못했습니다. 새로고침해 주세요." },
            );
          }}
        />
      )}
      {scheduleMismatch && (
        <OperationScheduleMismatchModal mismatch={scheduleMismatch} onClose={() => setScheduleMismatch(null)} />
      )}
      {closeConfirmOpen && (
        <OperationFinishModal
          schedule={props.schedule}
          rows={operationRows}
          labelPrintingEnabled={labelPrintingEnabled}
          autoAssignAbsenteesOnClose={autoAssignAbsenteesOnClose}
          reopening={operationStatus.closed}
          deleteAbsenteeInfoOnReopen={operationSettings.deleteAbsenteeInfoOnReopen}
          closing={closingOperation}
          onClose={() => setCloseConfirmOpen(false)}
          onConfirm={() => void finishOperation()}
        />
      )}
      {printModalOpen && !operationPrint.signatureOpen && (
        <OperationPrintModal
          schedule={props.schedule}
          templates={formTemplates}
          selectedTemplateCode={selectedTemplateCode}
          loading={templatesLoading}
          generating={generatingPdf}
          progress={printProgress}
          onSelect={operationPrint.setSelectedTemplateCode}
          onClose={operationPrint.close}
          onGenerate={() => void operationPrint.generate()}
        />
      )}
      {printModalOpen && operationPrint.signatureOpen && (
        <OperationSignatureModal
          templateName={formTemplates.find((template) => template.code === selectedTemplateCode)?.name || ""}
          fields={signatureFields}
          names={signatureNames}
          error={operationPrint.signatureError}
          onCloseError={operationPrint.dismissSignatureError}
          onChange={operationPrint.updateSignatureName}
          onClose={operationPrint.closeSignatures}
          onConfirm={() => void operationPrint.confirmSignatures()}
        />
      )}
      {drawPopoverOpen &&
        candidate &&
        (selectedMode === "RANDOM" || selectedMode === "SEQUENTIAL" || selectedMode === "MANUAL") &&
        drawPopoverPosition && (
          <OperationDrawPopover
            position={drawPopoverPosition}
            sequential={selectedMode === "SEQUENTIAL"}
            matching={selectedMode === "MANUAL"}
            manualNumber={manualNumber}
            onManualNumber={setManualNumber}
            sequentialPreviewNumber={sequentialPreviewNumber}
            previewLoading={searching}
            assignment={assignment}
            previewNumber={drawPreviewNumber}
            autoDrawEnabled={autoDrawEnabled}
            remainingMs={autoDrawRemainingMs}
            delaySeconds={autoDrawDelaySeconds}
            canAssign={Boolean(canAssign)}
            assigning={assigning}
            onClose={closeDrawPopover}
            onAssign={() => void assign()}
          />
        )}
    </div>
  );
}
