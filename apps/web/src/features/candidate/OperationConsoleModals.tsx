import type { OperationSchedule } from "../../shared/api/examinees";
import type { FormTemplate } from "../../shared/api/form-templates";
import { CancelButtonIcon, ConfirmButtonIcon } from "../../shared/components/ActionIcons";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import type { OperationScheduleMismatch } from "./operation-candidate-state";
import { operationTemplateScopeLabel } from "./operation-template-pages";
import type { OperationPrintProgress } from "./useOperationPrint";
import type { TemplateSignatureKey, TemplateSignatureNames } from "../templates/template-signatures";
import { formatScheduleDate, type OperationRow } from "./operation-view-model";
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
          <button type="button" onClick={onClose} aria-label="교시 안내창 닫기">
            ×
          </button>
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
  schedule: OperationSchedule;
  rows: OperationRow[];
  autoAssignAbsenteesOnClose: boolean;
  closing: boolean;
  onClose(): void;
  onConfirm(): void;
}

export function OperationFinishModal({
  schedule,
  rows,
  autoAssignAbsenteesOnClose,
  closing,
  onClose,
  onConfirm,
}: OperationFinishModalProps) {
  const dialogRef = useDialogFocus<HTMLElement>();
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
            <p>OPERATION CLOSE</p>
            <h2 id="operator-finish-title">가번호 등록을 마감하시겠습니까?</h2>
          </div>
          <button type="button" onClick={onClose} disabled={closing} aria-label="마감 확인창 닫기">
            ×
          </button>
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
            <span>현재 등록</span>
            <strong>
              {rows.filter((row) => row.assignment).length} / {rows.length}명
            </strong>
          </div>
          <div>
            <span>마감 정책</span>
            <strong>
              {autoAssignAbsenteesOnClose ? "미등록 수험생을 결시 처리하고 가번호 자동 부여" : "현재 등록 상태로 마감"}
            </strong>
          </div>
        </div>
        <p className="operator-finish-warning">마감 후에는 이 교시에서 가번호를 추가로 부여할 수 없습니다.</p>
        <footer>
          <button type="button" onClick={onClose} disabled={closing}>
            <CancelButtonIcon />
            <span>취소</span>
          </button>
          <button type="button" className="primary" onClick={onConfirm} disabled={closing}>
            <OperatorFinishIcon />
            <span>{closing ? "마감 처리 중…" : "등록 완료(마감)"}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}

interface OperationPrintModalProps {
  schedule: OperationSchedule;
  templates: FormTemplate[];
  selectedTemplateCode: string;
  loading: boolean;
  generating: boolean;
  progress: OperationPrintProgress | null;
  signatureFields: ReadonlyArray<{ key: TemplateSignatureKey; label: string }>;
  signatureNames: TemplateSignatureNames;
  onSelect(templateCode: string): void;
  onSignatureNameChange(key: TemplateSignatureKey, value: string): void;
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
  signatureFields,
  signatureNames,
  onSelect,
  onSignatureNameChange,
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
          <button type="button" onClick={onClose} aria-label={generating ? "PDF 생성 취소" : "인쇄창 닫기"}>
            ×
          </button>
        </header>
        <div className="operator-print-context">
          <span>{schedule.admissionName}</span>
          <strong>
            {schedule.date} · {schedule.time} · {schedule.periodName}
          </strong>
          <small>등록된 양식을 선택하면 현재 교시 데이터를 반영한 PDF 파일을 생성합니다.</small>
        </div>
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
        {signatureFields.length > 0 && (
          <section className="operator-print-signature-inputs" aria-labelledby="operator-print-signature-title">
            <header>
              <strong id="operator-print-signature-title">서명자명 입력</strong>
              <span>양식에 사용된 서명 태그에 입력한 이름이 PDF에 반영됩니다.</span>
            </header>
            <div>
              {signatureFields.map((field) => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  <input
                    type="text"
                    value={signatureNames[field.key]}
                    maxLength={100}
                    autoComplete="off"
                    disabled={generating}
                    required
                    placeholder={`${field.label} 이름을 입력하세요.`}
                    aria-label={`${field.label} 이름`}
                    onChange={(event) => onSignatureNameChange(field.key, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </section>
        )}
        <footer>
          <button type="button" onClick={onClose}>
            <CancelButtonIcon />
            <span>{generating ? "생성 취소" : "취소"}</span>
          </button>
          <button
            type="button"
            className="primary"
            onClick={onGenerate}
            disabled={!selectedTemplateCode || loading || generating}
          >
            <OperatorPrintIcon />
            <span>{generating ? "PDF 생성 중…" : "PDF 생성"}</span>
          </button>
        </footer>
      </section>
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
