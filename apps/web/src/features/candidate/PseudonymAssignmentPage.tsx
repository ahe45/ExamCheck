import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { AuthUser } from "../../shared/api/auth";
import type { OperationSchedule } from "../../shared/api/examinees";
import type { PrinterService } from "../printer/PrinterService";
import type { PrinterDiagnostic, PrinterMode } from "../printer/printer.types";
import { PrinterSetupPage } from "../setup/PrinterSetupPage";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import { ClientGridFilterLayer } from "../../shared/components/ClientDataGridControls";
import { useClientDataGrid } from "../../shared/hooks/useClientDataGrid";
import { operationScheduleKey } from "./operation-request-guard";
import type { OperationNotice } from "./operation-candidate-state";
import { OperationDrawPopover } from "./OperationDrawPopover";
import { OperationConsoleHeader } from "./OperationConsoleHeader";
import { OperationFinishModal, OperationPrintModal, OperationScheduleMismatchModal } from "./OperationConsoleModals";
import { OperationControlPanel } from "./OperationControlPanel";
import { OperationRosterPanel } from "./OperationRosterPanel";
import {
  operationColumns,
  operationRowValue,
  toRosterExportQuery,
  type OperationFieldKey,
  type OperationRow,
} from "./operation-view-model";
import { useOperationCandidateController } from "./useOperationCandidateController";
import { useOperationLabelPrint } from "./useOperationLabelPrint";
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
  diagnosticBusy: boolean;
  onDiagnose(): Promise<void>;
  onChangeSchedule(): void;
  onLogout(): void;
}

const DEFAULT_EXAM_NAME = import.meta.env.VITE_DEFAULT_EXAM_NAME || "2026년도 자격시험";
export function PseudonymAssignmentPage(props: Props) {
  const candidatePreviewRef = useRef<HTMLElement | null>(null);
  const headerSettingsRef = useRef<HTMLDivElement | null>(null);
  const noticeSinkRef = useRef<(notice: OperationNotice | null) => void>(() => undefined);
  const emitNotice = useCallback((notice: OperationNotice | null) => noticeSinkRef.current(notice), []);
  const [printerPageOpen, setPrinterPageOpen] = useState(false);
  const [drawPopoverPosition, setDrawPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  const [headerSettingsOpen, setHeaderSettingsOpen] = useState(false);
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
  const rosterGrid = useClientDataGrid<OperationRow, OperationFieldKey>({
    rows: operationRows,
    valueOf: operationRowValue,
    initialPageSize: 0,
    resetKey: currentScheduleKey,
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
    autoDrawEnabled,
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
    candidate,
    assignment,
    service: props.service,
    diagnostic: props.diagnostic,
    isCurrentTarget: candidateController.isCurrentTarget,
    onNotice: setNotice,
  });
  const { printing } = operationLabelPrint;
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

  useEscapeKey(Boolean(rosterGrid.filterMenu), rosterGrid.closeFilter);
  useEscapeKey(drawPopoverOpen, () => setDrawPopoverOpen(false));
  useEscapeKey(headerSettingsOpen, () => setHeaderSettingsOpen(false));
  useEscapeKey(closeConfirmOpen, () => {
    if (!closingOperation) setCloseConfirmOpen(false);
  });
  useEscapeKey(printModalOpen, () => {
    operationPrint.close();
  });
  useEscapeKey(Boolean(scheduleMismatch), () => setScheduleMismatch(null));

  useEffect(() => {
    setDrawPopoverPosition(null);
    setHeaderSettingsOpen(false);
    setCloseConfirmOpen(false);
    setPrinterPageOpen(false);
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
    await lookupExaminee(input);
  }

  function resetLookup() {
    candidateController.resetLookup();
    operationLabelPrint.reset();
  }

  async function finishOperation() {
    await operationRoster.finish(() => {
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
        busy={props.diagnosticBusy}
        onDiagnose={props.onDiagnose}
        onBack={() => setPrinterPageOpen(false)}
        onLogout={props.onLogout}
      />
    );
  }

  const labelPrintingEnabled = settingLoaded && selectedMode === "PREASSIGNED" && printPreassignedLabel;

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
        onResetLookup={() => {
          resetLookup();
          setHeaderSettingsOpen(false);
        }}
        onLogout={props.onLogout}
      />

      <div className="operator-console-body">
        <OperationControlPanel
          previewRef={candidatePreviewRef}
          input={input}
          searching={searching}
          notice={notice}
          candidate={candidate}
          useCandidatePhotos={useCandidatePhotos}
          photoUrl={photoUrl}
          selectedMode={selectedMode}
          assignment={assignment}
          manualNumber={manualNumber}
          canAssign={canAssign}
          assigning={assigning}
          onSearch={search}
          onInput={setInput}
          onReset={resetLookup}
          onCloseNotice={() => setNotice(null)}
          onManualNumber={setManualNumber}
          onAssign={() => void assign()}
        />

        <OperationRosterPanel
          rows={rosterGrid.filteredRows}
          allRows={operationRows}
          selectedExamineeNo={candidate?.examineeNo}
          grid={{
            sort: rosterGrid.sort,
            filters: rosterGrid.filters,
            cycleSort: rosterGrid.cycleSort,
            openFilter: rosterGrid.openFilter,
          }}
          state={{
            operationStatusLoaded,
            operationClosed: operationStatus.closed,
            closingOperation,
            rosterRefreshing,
            exportingExcel,
            labelPrintingEnabled,
            assignment,
            printing,
          }}
          actions={{
            refresh: () => void operationRoster.refresh(),
            openCloseConfirm: () => setCloseConfirmOpen(true),
            openPrint: () => void operationPrint.show(),
            download: () => void operationRoster.download(toRosterExportQuery(rosterGrid.filters, rosterGrid.sort)),
            printLabel: () => void operationLabelPrint.print(),
            select: selectOperationRow,
          }}
        />
      </div>
      <ClientGridFilterLayer
        columns={operationColumns}
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
      {scheduleMismatch && (
        <OperationScheduleMismatchModal mismatch={scheduleMismatch} onClose={() => setScheduleMismatch(null)} />
      )}
      {closeConfirmOpen && (
        <OperationFinishModal
          schedule={props.schedule}
          rows={operationRows}
          autoAssignAbsenteesOnClose={autoAssignAbsenteesOnClose}
          closing={closingOperation}
          onClose={() => setCloseConfirmOpen(false)}
          onConfirm={() => void finishOperation()}
        />
      )}
      {printModalOpen && (
        <OperationPrintModal
          schedule={props.schedule}
          templates={formTemplates}
          selectedTemplateCode={selectedTemplateCode}
          loading={templatesLoading}
          generating={generatingPdf}
          progress={printProgress}
          signatureFields={signatureFields}
          signatureNames={signatureNames}
          onSelect={operationPrint.setSelectedTemplateCode}
          onSignatureNameChange={operationPrint.updateSignatureName}
          onClose={operationPrint.close}
          onGenerate={() => void operationPrint.generate()}
        />
      )}
      {drawPopoverOpen && candidate && selectedMode === "RANDOM" && drawPopoverPosition && (
        <OperationDrawPopover
          position={drawPopoverPosition}
          assignment={assignment}
          previewNumber={drawPreviewNumber}
          autoDrawEnabled={autoDrawEnabled}
          remainingMs={autoDrawRemainingMs}
          delaySeconds={autoDrawDelaySeconds}
          canAssign={Boolean(canAssign)}
          assigning={assigning}
          onClose={() => setDrawPopoverOpen(false)}
          onAssign={() => void assign()}
        />
      )}
    </div>
  );
}
