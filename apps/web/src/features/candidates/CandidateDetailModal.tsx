import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  fetchCandidateDetail,
  fetchCandidatePhoto,
  saveCandidatePhoto,
  updateCandidate,
  type CandidateRecord,
  type CandidateFieldKey,
} from "../../shared/api/candidates";
import { ModalCloseButton } from "../../shared/components/ModalCloseButton";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import { candidateColumns, messageOf } from "./candidate-data-model";

const optionalFields = new Set<CandidateFieldKey>([
  "designatedSort",
  "major",
  "waitingRoom",
  "temporaryNo",
  "group",
  "answerSheet",
  "opt1",
  "opt2",
  "opt3",
  "opt4",
  "opt5",
  "opt6",
  "opt7",
  "opt8",
  "opt9",
  "opt10",
]);
type Fields = Record<CandidateFieldKey, string>;
function fieldsOf(row: CandidateRecord): Fields {
  return Object.fromEntries(candidateColumns.map(({ key }) => [key, row[key] ?? ""])) as Fields;
}

export function CandidateDetailModal({
  token,
  candidate,
  onClose,
  onSaved,
}: {
  token: string;
  candidate: CandidateRecord;
  onClose(): void;
  onSaved(): void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(true);
  const photoInput = useRef<HTMLInputElement>(null);
  const [original, setOriginal] = useState<CandidateRecord | null>(null);
  const [draft, setDraft] = useState<Fields>(() => fieldsOf(candidate));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoNotice, setPhotoNotice] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const dirty = Boolean(original && candidateColumns.some(({ key }) => draft[key] !== original[key]));

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetchCandidateDetail(token, candidate.id, controller.signal),
      fetchCandidatePhoto(token, candidate.id, controller.signal),
    ])
      .then(([row, photo]) => {
        if (controller.signal.aborted) return;
        setOriginal(row);
        setDraft(fieldsOf(row));
        setPhotoBlob(photo);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(messageOf(reason, "수험생 정보를 불러오지 못했습니다."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, candidate.id]);
  useEffect(() => {
    const url = photoBlob ? URL.createObjectURL(photoBlob) : null;
    setPhotoUrl(url);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [photoBlob]);

  function close() {
    if (busy) return;
    if (dirty) setDiscardOpen(true);
    else onClose();
  }
  useEscapeKey(true, () => {
    if (discardOpen) setDiscardOpen(false);
    else close();
  });

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!original || busy || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      await updateCandidate(token, original, draft);
      onSaved();
    } catch (reason) {
      setError(messageOf(reason, "수험생 정보를 저장하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(file?: File) {
    if (!file || busy || !original) return;
    if (!/\.(jpe?g|png)$/i.test(file.name) || file.size > 20 * 1024 * 1024) {
      setError("20MB 이하의 JPG, JPEG, PNG 사진을 선택해 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    setPhotoNotice("");
    try {
      await saveCandidatePhoto(token, candidate.id, file);
      setPhotoBlob(file);
      setPhotoNotice("사진을 저장했습니다.");
    } catch (reason) {
      setError(messageOf(reason, "사진을 저장하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      className="candidate-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="candidate-detail-title"
    >
      <form className="candidate-detail-modal" onSubmit={(event) => void save(event)}>
        <header>
          <div>
            <p>수험생 데이터</p>
            <h2 id="candidate-detail-title">수험생 정보 수정</h2>
          </div>
          <ModalCloseButton disabled={busy} onClick={close} />
        </header>
        {error && (
          <p className="candidate-detail-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <div className="candidate-detail-loading" role="status">
            수험생 정보를 불러오는 중입니다.
          </div>
        ) : (
          <div className="candidate-detail-layout">
            <fieldset className="candidate-detail-fields" disabled={busy || !original}>
              {candidateColumns.map(({ key, label }) => (
                <label key={key}>
                  <span>
                    {label}
                    {!optionalFields.has(key) && <b aria-hidden="true"> *</b>}
                  </span>
                  <input
                    aria-label={label}
                    required={!optionalFields.has(key)}
                    value={draft[key]}
                    type={key === "date" || key === "birth" ? "date" : key === "time" ? "time" : "text"}
                    inputMode={key === "answerSheet" ? "numeric" : undefined}
                    maxLength={key === "answerSheet" ? 8 : undefined}
                    onChange={(event) => {
                      setDraft((current) => ({ ...current, [key]: event.target.value }));
                      setDiscardOpen(false);
                    }}
                  />
                </label>
              ))}
            </fieldset>
            <aside className="candidate-detail-photo-panel">
              <div className="candidate-detail-photo-frame">
                {photoUrl ? (
                  <img src={photoUrl} alt={`${draft.name} 수험생 사진`} />
                ) : (
                  <div>
                    <strong>사진 없음</strong>
                    <span>JPG, JPEG, PNG</span>
                  </div>
                )}
              </div>
              <input
                ref={photoInput}
                type="file"
                accept="image/jpeg,image/png"
                hidden
                onChange={(event) => {
                  void uploadPhoto(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <button
                className="exam-outline-button"
                type="button"
                disabled={busy || !original}
                onClick={() => photoInput.current?.click()}
              >
                사진 업로드
              </button>
              {photoNotice && <p role="status">{photoNotice}</p>}
            </aside>
          </div>
        )}
        <footer>
          {discardOpen ? (
            <div className="candidate-detail-discard" role="alert">
              <span>저장하지 않은 변경사항을 버릴까요?</span>
              <button type="button" className="exam-outline-button" onClick={() => setDiscardOpen(false)}>
                계속 수정
              </button>
              <button type="button" className="exam-outline-button" onClick={onClose}>
                변경사항 버리기
              </button>
            </div>
          ) : (
            <>
              <span className="candidate-detail-required">* 필수 입력</span>
              <button className="exam-outline-button" type="button" disabled={busy} onClick={close}>
                취소
              </button>
              <button className="exam-primary-button" type="submit" disabled={busy || loading || !dirty}>
                {busy ? "저장 중…" : "저장"}
              </button>
            </>
          )}
        </footer>
      </form>
    </div>
  );
}
