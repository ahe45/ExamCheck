import { ToastNotice } from "../../shared/components/ToastNotice";
import { ModalCloseButton } from "../../shared/components/ModalCloseButton";
import { useEffect, useRef, useState } from "react";
import {
  downloadCandidateTemplate,
  pendingCandidateUpload,
  waitForCandidateUpload,
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
  const pollRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState("");
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
    const controller = new AbortController();
    pollRef.current = controller;
    const pending = pendingCandidateUpload();
    if (pending) {
      setUploadBusy(true);
      void waitForCandidateUpload(token, pending.jobId, { signal: controller.signal, onProgress: setProgress })
        .then(() => {
          if (!controller.signal.aborted) return onComplete("진행 중이던 수험생 등록 작업이 완료되었습니다.");
        })
        .catch((reason) => {
          if (!controller.signal.aborted) setError(messageOf(reason, "등록 결과를 확인하지 못했습니다."));
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setUploadBusy(false);
            setProgress("");
          }
        });
    }
    return () => controller.abort();
  }, [token, onComplete]);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  useEscapeKey(open, () => {
    if (!uploadBusy) onClose();
  });

  function chooseFiles(files: File[]) {
    if (uploadBusy) return;
    const selected = files[0];
    const isPhoto = uploadMode === "photos";
    const extension = isPhoto ? ".zip" : ".xlsx";
    if (files.length !== 1 || !selected.name.toLowerCase().endsWith(extension)) {
      if (isPhoto) {
        setPhotoFile(null);
        setPhotoPreview(null);
      } else {
        setFile(null);
        setPreview(null);
      }
      setError(
        files.length !== 1
          ? "한 번에 파일 한 개만 선택해 주세요."
          : isPhoto
            ? "ZIP 형식의 수험생 사진 파일을 선택해 주세요."
            : "XLSX 형식의 수험생 업로드 양식을 선택해 주세요.",
      );
      return;
    }
    if (isPhoto) void choosePhotoArchive(selected);
    else void chooseFile(selected);
  }

  async function chooseFile(selected: File) {
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

  async function choosePhotoArchive(selected: File) {
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
        const result = await importCandidatePhotoArchive(token, photoFile, policy, photoPreview.previewToken, {
          signal: pollRef.current?.signal,
          onProgress: setProgress,
        });
        message = `수험생 사진 ${result.uploaded + result.updated}건을 저장했습니다. 신규 ${result.uploaded}건 · 교체 ${result.updated}건 · 건너뜀 ${result.skipped}건`;
      } else {
        if (!file || !preview) return;
        const result = await importCandidateWorkbook(token, file, policy, preview.previewToken, {
          signal: pollRef.current?.signal,
          onProgress: setProgress,
        });
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
      setProgress("");
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
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => event.preventDefault()}
    >
      <section className="candidate-upload-modal">
        <header>
          <div>
            <p>수험생 데이터</p>
            <h2 id="candidate-upload-title">데이터 업로드</h2>
          </div>
          <ModalCloseButton
            onClick={() => {
              if (!uploadBusy) onClose();
            }}
          />
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
        {progress && (
          <p role="status" className="candidate-upload-progress">
            {progress}
          </p>
        )}
        {error && <ToastNotice notice={{ kind: "error", text: error }} onClose={() => setError(null)} />}
        {uploadMode === "workbook" ? (
          <WorkbookUploadSection
            busy={uploadBusy}
            downloadBusy={downloadBusy}
            file={file}
            preview={preview}
            onChoose={chooseFiles}
            onDownload={() => void downloadTemplate()}
          />
        ) : (
          <PhotoUploadSection busy={uploadBusy} file={photoFile} preview={photoPreview} onChoose={chooseFiles} />
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
