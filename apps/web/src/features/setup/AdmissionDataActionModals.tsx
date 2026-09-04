import { useEffect, useMemo, useState } from "react";
import {
  deleteAdmission,
  fetchAdmissionOperationSchedules,
  resetAdmissionOperations,
  type AdmissionOperationSchedule,
} from "../../shared/api/pseudonyms";
import { CancelButtonIcon, DeleteButtonIcon, ResetButtonIcon } from "../../shared/components/ActionIcons";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";

interface ResetModalProps {
  token: string;
  examName: string;
  admissionName: string;
  onClose(): void;
  onCompleted(resetScheduleCount: number, deletedAssignmentCount: number): void;
}

export function AdmissionOperationsResetModal({
  token,
  examName,
  admissionName,
  onClose,
  onCompleted,
}: ResetModalProps) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const [schedules, setSchedules] = useState<AdmissionOperationSchedule[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedSchedules = useMemo(
    () => schedules.filter((schedule) => selectedKeys.has(scheduleKey(schedule))),
    [schedules, selectedKeys],
  );

  useEscapeKey(!resetting, onClose);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void fetchAdmissionOperationSchedules(token, examName, admissionName)
      .then((result) => {
        if (active) setSchedules(result);
      })
      .catch((reason) => {
        if (active) setError(messageOf(reason, "교시 목록을 불러오지 못했습니다."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [admissionName, examName, token]);

  function toggle(schedule: AdmissionOperationSchedule) {
    const key = scheduleKey(schedule);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelectedKeys((current) => (current.size === schedules.length ? new Set() : new Set(schedules.map(scheduleKey))));
  }

  async function resetSelected() {
    if (!selectedSchedules.length || resetting) return;
    setResetting(true);
    setError(null);
    try {
      const result = await resetAdmissionOperations(token, {
        examName,
        admissionName,
        schedules: selectedSchedules.map(({ examDate, examTime, periodName }) => ({
          examDate,
          examTime,
          periodName,
        })),
      });
      onCompleted(result.resetScheduleCount, result.deletedAssignmentCount);
    } catch (reason) {
      setError(messageOf(reason, "선택한 교시의 운영 이력을 초기화하지 못했습니다."));
    } finally {
      setResetting(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      className="system-settings-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admission-operation-reset-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !resetting) onClose();
      }}
    >
      <section className="admission-data-action-modal reset">
        <header>
          <span>
            <ResetButtonIcon />
          </span>
          <div>
            <p>OPERATION HISTORY RESET</p>
            <h2 id="admission-operation-reset-title">{admissionName} 운영 이력 초기화</h2>
          </div>
        </header>
        <div className="admission-operation-reset-description">
          <strong>초기화할 교시를 선택해 주세요.</strong>
          <span>선택한 교시의 가번호 배정과 마감 상태가 삭제되고, 가번호 범위의 사용 위치가 처음으로 돌아갑니다.</span>
        </div>
        {error && (
          <p className="admission-data-action-error" role="alert">
            {error}
          </p>
        )}
        <div className="admission-operation-list-head">
          <label>
            <input
              type="checkbox"
              checked={schedules.length > 0 && selectedKeys.size === schedules.length}
              onChange={toggleAll}
              disabled={loading || resetting || schedules.length === 0}
            />
            <span>전체 선택</span>
          </label>
          <strong>{selectedSchedules.length.toLocaleString()}개 선택</strong>
        </div>
        <div className="admission-operation-list">
          {loading ? (
            <p>교시 목록을 불러오고 있습니다.</p>
          ) : schedules.length ? (
            schedules.map((schedule) => {
              const key = scheduleKey(schedule);
              return (
                <label className={selectedKeys.has(key) ? "selected" : ""} key={key}>
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(key)}
                    onChange={() => toggle(schedule)}
                    disabled={resetting}
                  />
                  <span className="admission-operation-date">{schedule.examDate}</span>
                  <strong>
                    {schedule.examTime} · {schedule.periodName}
                  </strong>
                  <span>{schedule.buildingNames.length ? schedule.buildingNames.join(" · ") : "고사건물 미지정"}</span>
                  <small>
                    수험생 {schedule.candidateCount.toLocaleString()}명 · 배정 {schedule.assignedCount.toLocaleString()}
                    명{schedule.closed ? " · 마감" : ""}
                  </small>
                </label>
              );
            })
          ) : (
            <p>초기화할 교시가 없습니다.</p>
          )}
        </div>
        <footer>
          <button type="button" className="exam-ghost-button" onClick={onClose} disabled={resetting}>
            <CancelButtonIcon />
            <span>취소</span>
          </button>
          <button
            type="button"
            className="exam-primary-button"
            onClick={() => void resetSelected()}
            disabled={!selectedSchedules.length || resetting}
          >
            <ResetButtonIcon />
            <span>{resetting ? "초기화 중…" : "선택 교시 초기화"}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}

interface DeleteModalProps {
  token: string;
  admissionName: string;
  onClose(): void;
  onCompleted(deletedCandidateCount: number): void;
}

export function AdmissionDeleteModal({ token, admissionName, onClose, onCompleted }: DeleteModalProps) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const [currentPassword, setCurrentPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscapeKey(!deleting, onClose);

  async function remove() {
    if (!currentPassword || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await deleteAdmission(token, admissionName, currentPassword);
      onCompleted(result.deletedCandidateCount);
    } catch (reason) {
      setError(messageOf(reason, "전형 데이터를 삭제하지 못했습니다."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      className="system-settings-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admission-delete-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onClose();
      }}
    >
      <form
        className="admission-data-action-modal delete"
        onSubmit={(event) => {
          event.preventDefault();
          void remove();
        }}
      >
        <header>
          <span>!</span>
          <div>
            <p>ADMISSION DATA DELETE</p>
            <h2 id="admission-delete-title">{admissionName} 전형을 삭제하시겠습니까?</h2>
          </div>
        </header>
        <div className="admission-delete-warning">
          <strong>이 작업은 되돌릴 수 없습니다.</strong>
          <span>수험생, 사진, 가번호 배정, 운영 상태와 전형 설정이 모두 삭제되며 별도 백업은 생성하지 않습니다.</span>
        </div>
        <label className="admission-delete-password">
          <span>현재 로그인한 계정의 비밀번호</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            maxLength={1024}
            disabled={deleting}
            placeholder="비밀번호를 입력하세요."
            autoFocus
          />
        </label>
        {error && (
          <p className="admission-data-action-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="exam-ghost-button" onClick={onClose} disabled={deleting}>
            <CancelButtonIcon />
            <span>취소</span>
          </button>
          <button type="submit" className="exam-danger-button" disabled={!currentPassword || deleting}>
            <DeleteButtonIcon />
            <span>{deleting ? "삭제 중…" : "전형 전체 삭제"}</span>
          </button>
        </footer>
      </form>
    </div>
  );
}

function scheduleKey(schedule: { examDate: string; examTime: string; periodName: string }) {
  return [schedule.examDate, schedule.examTime, schedule.periodName].join("\u001f");
}

function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}
