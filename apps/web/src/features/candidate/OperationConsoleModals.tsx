import { ToastNotice } from "../../shared/components/ToastNotice";
import { ModalCloseButton } from "../../shared/components/ModalCloseButton";
import type { OperationSchedule } from "../../shared/api/examinees";
import type { FormTemplateSummary } from "../../shared/api/form-templates";
import { CancelButtonIcon, ConfirmButtonIcon } from "../../shared/components/ActionIcons";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import type { OperationScheduleMismatch } from "./operation-candidate-state";
import { operationTemplateScopeLabel, type OperationPrintTarget } from "./operation-template-pages";
import type { OperationPrintProgress } from "./useOperationPrint";
import type { TemplateSignatureKey, TemplateSignatureNames } from "../templates/template-signatures";
import { formatScheduleDate, operationRosterStats, type OperationRow } from "./operation-view-model";
import { OperatorFinishIcon } from "./OperationRosterPanel";

interface ScheduleMismatchModalProps {
  mismatch: OperationScheduleMismatch;
  onClose(): void;
}

export function OperationScheduleMismatchModal({ mismatch, onClose }: ScheduleMismatchModalProps) {
  const dialogRef = useDialogFocus<HTMLElement>();
  return (
    <div
      className="operator-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="operator-schedule-alert-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="operator-schedule-alert-title"
      >
        <header>
          <span className="operator-schedule-alert-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 3 2.8 19h18.4L12 3Z" />
              <path d="M12 9v4.5M12 17h.01" />
            </svg>
          </span>
          <div>
            <p>SCHEDULE INFORMATION</p>
            <h2 id="operator-schedule-alert-title">다른 교시에 배정된 수험생입니다.</h2>
          </div>
          <ModalCloseButton onClick={onClose} aria-label="교시 안내창 닫기" />
        </header>
        <div className="operator-schedule-alert-candidate">
          <span>조회 수험생</span>
          <strong>
            {mismatch.examineeNo} · {mismatch.name}
          </strong>
          <small>현재 접속한 교시에서는 이 수험생의 가번호를 등록할 수 없습니다.</small>
        </div>
        <div className="operator-schedule-alert-list">
          <h3>배정된 교시 정보</h3>
          {mismatch.schedules.map((schedule, index) => (
            <article
              key={`${schedule.examDate}|${schedule.examTime}|${schedule.periodName}|${schedule.admissionName}|${index}`}
            >
              <div>
                <span>시험일자</span>
                <strong>{formatScheduleDate(schedule.examDate)}</strong>
              </div>
              <div>
                <span>시험시간</span>
                <strong>{schedule.examTime}</strong>
              </div>
              <div>
                <span>교시명</span>
                <strong>{schedule.periodName || "-"}</strong>
              </div>
              <div>
                <span>전형명</span>
                <strong>{schedule.admissionName || "-"}</strong>
              </div>
              <div>
                <span>고사장소</span>
                <strong>{[schedule.buildingName, schedule.roomName].filter(Boolean).join(" · ") || "-"}</strong>
              </div>
            </article>
          ))}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            <ConfirmButtonIcon />
            <span>확인</span>
          </button>
        </footer>
      </section>
    </div>
  );
}

interface OperationFinishModalProps {
  reopening?: boolean;
  deleteAbsenteeInfoOnReopen?: boolean;
  schedule: OperationSchedule;
  rows: OperationRow[];
  labelPrintingEnabled: boolean;
  autoAssignAbsenteesOnClose: boolean;
  closing: boolean;
  onClose(): void;
  onConfirm(): void;
}

export function OperationFinishModal({
  reopening = false,
  deleteAbsenteeInfoOnReopen = false,
  schedule,
  rows,
  labelPrintingEnabled,
  autoAssignAbsenteesOnClose,
  closing,
  onClose,
  onConfirm,
}: OperationFinishModalProps) {
  const dialogRef = useDialogFocus<HTMLElement>();
  const processedCount = operationRosterStats(rows, {
    operationClosed: false,
    labelPrintingEnabled,
  }).assignedCount;
  return (
    <div
      className="operator-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closing) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="operator-finish-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="operator-finish-title"
      >
        <header>
          <span>
            <OperatorFinishIcon />
          </span>
          <div>
            <p>{reopening ? "OPERATION REOPEN" : "OPERATION CLOSE"}</p>
            <h2 id="operator-finish-title">
              {reopening ? "등록 마감을 취소하시겠습니까?" : "가번호 등록을 마감하시겠습니까?"}
            </h2>
          </div>
          <ModalCloseButton onClick={onClose} disabled={closing} aria-label="마감 확인창 닫기" />
        </header>
        <div className="operator-finish-summary">
          <div>
            <span>대상 교시</span>
            <strong>
              {schedule.date} · {schedule.time} · {schedule.periodName}
            </strong>
          </div>
          <div>
            <span>전형명</span>
            <strong>{schedule.admissionName}</strong>
          </div>
          <div>
            <span>{labelPrintingEnabled ? "현재 출력" : "현재 등록"}</span>
            <strong>
              {processedCount} / {rows.length}명
            </strong>
          </div>
          <div>
            <span>{reopening ? "마감 취소 정책" : "마감 정책"}</span>
            <strong>
              {reopening
                ? deleteAbsenteeInfoOnReopen
                  ? "마감 시 자동 부여된 결시자 가번호 삭제"
                  : "기존 가번호 부여 내역 유지"
                : autoAssignAbsenteesOnClose
                  ? "미등록 수험생을 결시 처리하고 가번호 자동 부여"
                  : "현재 등록 상태로 마감"}
            </strong>
          </div>
        </div>
        <p className="operator-finish-warning">
          {reopening
            ? "마감을 취소하면 이 교시에서 가번호 등록을 다시 진행할 수 있습니다. 라벨 출력이력은 유지됩니다."
            : "마감 후에는 이 교시에서 가번호를 추가로 부여할 수 없습니다."}
        </p>
        <footer>
          <button type="button" onClick={onClose} disabled={closing}>
            <CancelButtonIcon />
            <span>취소</span>
          </button>
          <button type="button" className="primary" onClick={onConfirm} disabled={closing}>
            <OperatorFinishIcon />
            <span>
              {closing ? (reopening ? "마감 취소 중…" : "마감 처리 중…") : reopening ? "마감 취소" : "운영 마감"}
            </span>
          </button>
        </footer>
      </section>
    </div>
  );
}

interface OperationPrintModalProps {
  printTarget: OperationPrintTarget;
  onPrintTargetChange(target: OperationPrintTarget): void;
  totalCount: number;
  presentCount: number;
  schedule: OperationSchedule;
  templates: FormTemplateSummary[];
  selectedTemplateCode: string;
  loading: boolean;
  generating: boolean;
  progress: OperationPrintProgress | null;
  onSelect(templateCode: string): void;
  onClose(): void;
  onGenerate(): void;
}

export function OperationPrintModal({
  schedule,
  templates,
  selectedTemplateCode,
  loading,
  generating,
  progress,
  printTarget,
  onPrintTargetChange,
  totalCount,
  presentCount,
  onSelect,
  onClose,
  onGenerate,
}: OperationPrintModalProps) {
  const dialogRef = useDialogFocus<HTMLElement>();
  return (
    <div
      className="operator-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !generating) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="operator-print-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="operator-print-title"
      >
        <header>
          <span>
            <OperatorPrintIcon />
          </span>
          <div>
            <p>FORM PRINT</p>
            <h2 id="operator-print-title">인쇄 양식 선택</h2>
          </div>
          <ModalCloseButton onClick={onClose} aria-label={generating ? "PDF 생성 취소" : "인쇄창 닫기"} />
        </header>
        <div className="operator-print-context">
          <span>{schedule.admissionName}</span>
          <strong>
            {schedule.date} · {schedule.time} · {schedule.periodName}
          </strong>
          <small>등록된 양식을 선택하면 현재 교시 데이터를 반영한 PDF 파일을 생성합니다.</small>
        </div>
        <fieldset className="operator-print-target" disabled={generating}>
          <legend>출력 대상</legend>
          <label>
            <input
              type="radio"
              name="operator-print-target"
              value="ALL"
              checked={printTarget === "ALL"}
              onChange={() => onPrintTargetChange("ALL")}
            />
            <span>
              전체 <small>({totalCount.toLocaleString()}명)</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="operator-print-target"
              value="PRESENT"
              checked={printTarget === "PRESENT"}
              onChange={() => onPrintTargetChange("PRESENT")}
            />
            <span>
              응시만 <small>({presentCount.toLocaleString()}명)</small>
            </span>
          </label>
          {(printTarget === "PRESENT" ? presentCount : totalCount) === 0 && (
            <p>선택한 출력 대상에 해당하는 수험생이 없습니다.</p>
          )}
        </fieldset>
        {generating && progress && (
          <div className="operator-print-progress" aria-live="polite">
            <div>
              <strong>{progress.label}</strong>
              <span>
                {progress.completed} / {progress.total}
              </span>
            </div>
            <progress max={Math.max(progress.total, 1)} value={progress.completed}>
              {Math.round((progress.completed / Math.max(progress.total, 1)) * 100)}%
            </progress>
          </div>
        )}
        <div className="operator-print-template-list">
          {loading ? (
            <div className="operator-print-empty">양식 목록을 불러오고 있습니다.</div>
          ) : templates.length ? (
            templates.map((template) => (
              <label className={selectedTemplateCode === template.code ? "selected" : ""} key={template.id}>
                <input
                  type="radio"
                  name="operator-print-template"
                  disabled={generating}
                  value={template.code}
                  checked={selectedTemplateCode === template.code}
                  onChange={() => onSelect(template.code)}
                />
                <span className="operator-template-radio" />
                <span className="operator-template-paper">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="operator-template-copy">
                  <strong>{template.name}</strong>
                  <small>
                    {template.category} · {operationTemplateScopeLabel(template.usageScope)}
                  </small>
                  <em>{template.description || "등록된 설명이 없습니다."}</em>
                </span>
              </label>
            ))
          ) : (
            <div className="operator-print-empty">
              <strong>사용 가능한 양식이 없습니다.</strong>
              <span>관리자페이지 양식관리에서 사용자 제공 양식을 먼저 등록해 주세요.</span>
            </div>
          )}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            <CancelButtonIcon />
            <span>{generating ? "생성 취소" : "취소"}</span>
          </button>
          <button
            type="button"
            className="primary"
            onClick={onGenerate}
            disabled={
              !selectedTemplateCode ||
              loading ||
              generating ||
              (printTarget === "PRESENT" ? presentCount : totalCount) === 0
            }
          >
            <OperatorPrintIcon />
            <span>{generating ? "PDF 생성 중…" : "PDF 생성"}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}

export function OperationSignatureModal({
  templateName,
  fields,
  names,
  error,
  onCloseError,
  onChange,
  onClose,
  onConfirm,
}: {
  templateName: string;
  fields: ReadonlyArray<{ key: TemplateSignatureKey; label: string }>;
  names: TemplateSignatureNames;
  error: string | null;
  onCloseError?(): void;
  onChange(key: TemplateSignatureKey, value: string): void;
  onClose(): void;
  onConfirm(): void;
}) {
  const dialogRef = useDialogFocus<HTMLFormElement>();
  return (
    <div
      className="operator-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        ref={dialogRef}
        className="operator-print-modal operator-signature-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="operator-signature-title"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <header>
          <span>
            <OperatorPrintIcon />
          </span>
          <div>
            <p>FORM PRINT</p>
            <h2 id="operator-signature-title">서명자명 입력</h2>
          </div>
          <ModalCloseButton onClick={onClose} aria-label="서명자명 입력창 닫기" />
        </header>
        <div className="operator-print-context">
          <strong>{templateName}</strong>
          <small>PDF에 표시할 이름을 입력해 주세요.</small>
        </div>
        <section className="operator-print-signature-inputs">
          <div>
            {fields.map((field, index) => (
              <label key={field.key}>
                <span>{field.label}</span>
                <input
                  type="text"
                  value={names[field.key]}
                  maxLength={100}
                  autoComplete="off"
                  required
                  data-dialog-autofocus={index === 0 ? "true" : undefined}
                  placeholder={`${field.label} 이름을 입력하세요.`}
                  aria-label={`${field.label} 이름`}
                  onChange={(event) => onChange(field.key, event.target.value)}
                />
              </label>
            ))}
          </div>
          {error && <ToastNotice notice={{ kind: "error", text: error }} onClose={onCloseError} />}
        </section>
        <footer>
          <button type="button" onClick={onClose}>
            <CancelButtonIcon />
            <span>취소</span>
          </button>
          <button type="submit" className="primary">
            <OperatorPrintIcon />
            <span>PDF 생성</span>
          </button>
        </footer>
      </form>
    </div>
  );
}

function OperatorPrintIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5.2 7V3.4h9.6V7M5 14H3.4V8h13.2v6H15M5.2 11.5h9.6v5.1H5.2z" />
      <path d="M14 9.7h.1" />
    </svg>
  );
}
