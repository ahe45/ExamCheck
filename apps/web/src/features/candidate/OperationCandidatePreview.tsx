import type { RefObject } from "react";
import type { Examinee } from "../../shared/api/examinees";
import type { AssignmentMode, PseudonymAssignment } from "../../shared/api/pseudonyms";

interface Props {
  previewRef?: RefObject<HTMLElement | null>;
  candidate: Examinee | null;
  assignment: PseudonymAssignment | null;
  selectedMode: AssignmentMode;
  useCandidatePhotos: boolean;
  photoUrl: string | null;
}

export function OperationCandidatePreview({
  previewRef,
  candidate,
  assignment,
  selectedMode,
  useCandidatePhotos,
  photoUrl,
}: Props) {
  return (
    <section className="operator-candidate-preview" ref={previewRef}>
      <dl>
        <div>
          <dt>수험번호</dt>
          <dd>{candidate?.examineeNo || "-"}</dd>
        </div>
        <div>
          <dt>성명</dt>
          <dd>{candidate?.name || "-"}</dd>
        </div>
        <div>
          <dt>생년월일</dt>
          <dd>{candidate?.birthDate || "-"}</dd>
        </div>
        <div>
          <dt>가번호</dt>
          <dd>
            {assignment?.pseudonymNumber ||
              (selectedMode === "PREASSIGNED" ? candidate?.preassignedNumber : null) ||
              "-"}
          </dd>
        </div>
        <div>
          <dt>지원전형</dt>
          <dd>{candidate?.admissionName || "-"}</dd>
        </div>
        <div>
          <dt>모집단위</dt>
          <dd>{candidate?.unitName || "-"}</dd>
        </div>
        <div>
          <dt>전공</dt>
          <dd>{candidate?.majorName || "-"}</dd>
        </div>
      </dl>
      <div className="operator-photo-row">
        <div className="operator-photo-label">사진</div>
        <div className="operator-photo-area">
          {useCandidatePhotos && photoUrl ? (
            <img src={photoUrl} alt={`${candidate?.name || "수험생"} 사진`} />
          ) : (
            <span className="empty-photo" role="img" aria-label="수험생 사진 없음">
              <OperatorPersonIcon />
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function OperatorPersonIcon() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <circle cx="48" cy="32" r="17" />
      <path d="M18 82c1.8-20.2 13.8-31 30-31s28.2 10.8 30 31" />
    </svg>
  );
}
