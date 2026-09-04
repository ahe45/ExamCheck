import type { ChangeEvent } from "react";
import type { CandidatePhotoPreview, CandidateUploadPolicy, CandidateUploadPreview } from "../../shared/api/candidates";
import { DownloadButtonIcon } from "../../shared/components/ActionIcons";
import { candidateUploadPolicies, photoPolicyDescription } from "./candidate-data-model";

interface WorkbookUploadSectionProps {
  busy: boolean;
  downloadBusy: boolean;
  error: string | null;
  file: File | null;
  preview: CandidateUploadPreview | null;
  onChoose(event: ChangeEvent<HTMLInputElement>): void;
  onDownload(): void;
}

export function WorkbookUploadSection({
  busy,
  downloadBusy,
  error,
  file,
  preview,
  onChoose,
  onDownload,
}: WorkbookUploadSectionProps) {
  return (
    <>
      <div className="candidate-upload-file-panel">
        <label>
          <input type="file" accept=".xlsx" onChange={onChoose} disabled={busy} />
          <span>{file?.name || "XLSX 파일 선택"}</span>
        </label>
        <button className="exam-outline-button" onClick={onDownload} disabled={busy || downloadBusy}>
          <DownloadButtonIcon />
          <span>업로드 양식 다운로드</span>
        </button>
      </div>
      <section className="candidate-upload-preview">
        <div className="candidate-upload-preview-head">
          <div>
            <strong>수험생 데이터 미리보기</strong>
            <p>
              {preview
                ? `${preview.fileName} 기준으로 반영 대상을 확인했습니다.`
                : "XLSX 파일을 선택하면 신규, 수정, 동일 데이터 건수를 먼저 확인합니다."}
            </p>
          </div>
          {preview && <span>총 {preview.totalRows.toLocaleString()}건</span>}
        </div>
        {error && (
          <p className="candidate-upload-preview-error" role="alert">
            {error}
          </p>
        )}
        <div className="candidate-upload-summary">
          <div className="insert">
            <span>신규</span>
            <strong>{preview ? preview.insertCount.toLocaleString() : "-"}</strong>
          </div>
          <div className="update">
            <span>수정</span>
            <strong>{preview ? preview.updateCount.toLocaleString() : "-"}</strong>
          </div>
          <div>
            <span>동일</span>
            <strong>{preview ? preview.unchangedCount.toLocaleString() : "-"}</strong>
          </div>
        </div>
      </section>
    </>
  );
}

interface PhotoUploadSectionProps {
  busy: boolean;
  error: string | null;
  file: File | null;
  preview: CandidatePhotoPreview | null;
  onChoose(event: ChangeEvent<HTMLInputElement>): void;
}

export function PhotoUploadSection({ busy, error, file, preview, onChoose }: PhotoUploadSectionProps) {
  return (
    <>
      <div className="candidate-upload-file-panel photo">
        <label>
          <input type="file" accept=".zip,application/zip" onChange={onChoose} disabled={busy} />
          <span>{file?.name || "수험생 사진 ZIP 파일 선택"}</span>
        </label>
      </div>
      <section className="candidate-upload-preview">
        <div className="candidate-upload-preview-head">
          <div>
            <strong>수험생 사진 미리보기</strong>
            <p>
              {preview
                ? `${preview.fileName}에서 수험번호와 사진 파일을 대조했습니다.`
                : "사진 파일명에 수험번호를 넣고 JPG, JPEG, PNG 파일을 ZIP으로 압축해 주세요."}
            </p>
          </div>
          {preview && <span>총 {preview.totalFiles.toLocaleString()}개</span>}
        </div>
        {error && (
          <p className="candidate-upload-preview-error" role="alert">
            {error}
          </p>
        )}
        <div className="candidate-upload-summary">
          <div className="insert">
            <span>매칭 가능</span>
            <strong>{preview ? preview.matchedCount.toLocaleString() : "-"}</strong>
          </div>
          <div className="update">
            <span>건너뜀</span>
            <strong>{preview ? preview.skippedCount.toLocaleString() : "-"}</strong>
          </div>
          <div>
            <span>중복</span>
            <strong>{preview ? preview.duplicateCount.toLocaleString() : "-"}</strong>
          </div>
        </div>
      </section>
    </>
  );
}

interface CandidateUploadPolicySectionProps {
  disabled: boolean;
  mode: "workbook" | "photos";
  policy: CandidateUploadPolicy;
  onChange(policy: CandidateUploadPolicy): void;
}

export function CandidateUploadPolicySection({ disabled, mode, policy, onChange }: CandidateUploadPolicySectionProps) {
  return (
    <section className="candidate-upload-policy">
      <div>
        <strong>기존 {mode === "photos" ? "사진" : "데이터"} 처리</strong>
        <span>
          {mode === "photos"
            ? "수험번호가 같은 수험생 기준"
            : "수험번호·시험날짜·시험시간·교시명·고사건물명이 같은 데이터 기준"}
        </span>
      </div>
      {candidateUploadPolicies.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name="candidate-upload-policy"
            checked={policy === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          <span>
            <strong>{option.label}</strong>
            <small>{mode === "photos" ? photoPolicyDescription(option.value) : option.description}</small>
          </span>
        </label>
      ))}
    </section>
  );
}
