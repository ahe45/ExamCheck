import { useEffect, useState, type ChangeEvent } from "react";
import {
  downloadCandidateTemplate,
  importCandidatePhotoArchive,
  importCandidateWorkbook,
  previewCandidatePhotoArchive,
  previewCandidateWorkbook,
  type CandidatePhotoPreview,
  type CandidateUploadPolicy,
  type CandidateUploadPreview,
} from "../../shared/api/candidates";
import { CancelButtonIcon, UploadButtonIcon } from "../../shared/components/ActionIcons";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import { messageOf, workbookPreviewErrorMessage } from "./candidate-data-model";
import { CandidateUploadPolicySection, PhotoUploadSection, WorkbookUploadSection } from "./CandidateUploadSections";

interface CandidateUploadModalProps {
  open: boolean;
  token: string;
  onClose(): void;
  onComplete(message: string): Promise<void>;
}

export function CandidateUploadModal({ open, token, onClose, onComplete }: CandidateUploadModalProps) {
  const dialogRef = useDialogFocus<HTMLDivElement>(open);
  const [uploadMode, setUploadMode] = useState<"workbook" | "photos">("workbook");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CandidateUploadPreview | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<CandidatePhotoPreview | null>(null);
  const [policy, setPolicy] = useState<CandidateUploadPolicy>("insert-update");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  useEscapeKey(open, () => {
    if (!uploadBusy) onClose();
  });

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] || null;
    event.target.value = "";
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".xlsx")) {
      setFile(null);
      setPreview(null);
      setError("XLSX 형식의 수험생 업로드 양식을 선택해 주세요.");
      return;
    }
    setFile(selected);
    setPreview(null);
    setError(null);
    setUploadBusy(true);
    try {
      setPreview(await previewCandidateWorkbook(token, selected));
    } catch (reason) {
      setError(workbookPreviewErrorMessage(reason));
    } finally {
      setUploadBusy(false);
    }
  }

  async function choosePhotoArchive(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] || null;
    event.target.value = "";
    if (!selected) return;
    setPhotoFile(selected);
    setPhotoPreview(null);
    setError(null);
    setUploadBusy(true);
    try {
      setPhotoPreview(await previewCandidatePhotoArchive(token, selected));
    } catch (reason) {
      setError(messageOf(reason, "사진 업로드 미리보기를 생성하지 못했습니다."));
    } finally {
      setUploadBusy(false);
    }
  }

  async function executeUpload() {
    if (uploadBusy) return;
    setUploadBusy(true);
    setError(null);
    try {
      let message: string;
      if (uploadMode === "photos") {
        if (!photoFile || !photoPreview) return;
        const result = await importCandidatePhotoArchive(token, photoFile, policy, photoPreview.previewToken);
        message = `수험생 사진 ${result.uploaded + result.updated}건을 저장했습니다. 신규 ${result.uploaded}건 · 교체 ${result.updated}건 · 건너뜀 ${result.skipped}건`;
      } else {
        if (!file || !preview) return;
        const result = await importCandidateWorkbook(token, file, policy, preview.previewToken);
        message = `수험생 데이터 ${result.inserted + result.updated}건을 저장했습니다. 신규 ${result.inserted}건 · 수정 ${result.updated}건 · 건너뜀 ${result.skipped}건`;
      }
      onClose();
      setFile(null);
      setPreview(null);
      setPhotoFile(null);
      setPhotoPreview(null);
      await onComplete(message);
    } catch (reason) {
      setError(
        messageOf(
          reason,
          uploadMode === "photos" ? "수험생 사진을 업로드하지 못했습니다." : "수험생 데이터를 업로드하지 못했습니다.",
        ),
      );
    } finally {
      setUploadBusy(false);
    }
  }

  async function downloadTemplate() {
    setDownloadBusy(true);
    setError(null);
    try {
      await downloadCandidateTemplate(token);
    } catch (reason) {
      setError(messageOf(reason, "파일을 다운로드하지 못했습니다."));
    } finally {
      setDownloadBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="candidate-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="candidate-upload-title"
    >
      <section className="candidate-upload-modal">
        <header>
          <div>
            <p>수험생 데이터</p>
            <h2 id="candidate-upload-title">데이터 업로드</h2>
          </div>
          <button
            onClick={() => {
              if (!uploadBusy) onClose();
            }}
            aria-label="닫기"
          >
            ×
          </button>
        </header>
        <div className="candidate-upload-tabs">
          <button
            className={uploadMode === "workbook" ? "active" : ""}
            disabled={uploadBusy}
            onClick={() => {
              setUploadMode("workbook");
              setError(null);
            }}
          >
            수험생 데이터
          </button>
          <button
            className={uploadMode === "photos" ? "active" : ""}
            disabled={uploadBusy}
            onClick={() => {
              setUploadMode("photos");
              setError(null);
            }}
          >
            수험생 사진
          </button>
        </div>
        {uploadMode === "workbook" ? (
          <WorkbookUploadSection
            busy={uploadBusy}
            downloadBusy={downloadBusy}
            error={error}
            file={file}
            preview={preview}
            onChoose={(event) => void chooseFile(event)}
            onDownload={() => void downloadTemplate()}
          />
        ) : (
          <PhotoUploadSection
            busy={uploadBusy}
            error={error}
            file={photoFile}
            preview={photoPreview}
            onChoose={(event) => void choosePhotoArchive(event)}
          />
        )}
        <CandidateUploadPolicySection disabled={uploadBusy} mode={uploadMode} policy={policy} onChange={setPolicy} />
        <footer>
          <button onClick={onClose} disabled={uploadBusy}>
            <CancelButtonIcon />
            <span>취소</span>
          </button>
          <button
            className="primary"
            onClick={() => void executeUpload()}
            disabled={uploadMode === "photos" ? !photoPreview || uploadBusy : !preview || uploadBusy}
          >
            <UploadButtonIcon />
            <span>{uploadBusy ? "처리 중…" : "업로드 실행"}</span>
          </button>
        </footer>
        {uploadBusy && (
          <div className="candidate-upload-busy" role="status">
            <span />
            <strong>
              {uploadMode === "photos"
                ? photoPreview
                  ? "수험생 사진을 저장하고 있습니다."
                  : "사진 파일을 확인하고 있습니다."
                : preview
                  ? "수험생 데이터를 저장하고 있습니다."
                  : "업로드 파일을 확인하고 있습니다."}
            </strong>
            <small>잠시만 기다려 주세요.</small>
          </div>
        )}
      </section>
    </div>
  );
}
