import {
  assignmentMethodDetail,
  assignmentMethodLabel,
  rangeSummary,
  type AdmissionCardData,
} from "./system-settings-overview-model";
import { DeleteButtonIcon, ResetButtonIcon } from "../../shared/components/ActionIcons";

interface Props {
  card: AdmissionCardData;
  onOpen(admissionName: string): void;
  onReset(admissionName: string): void;
  onDelete(admissionName: string): void;
}

export function AdmissionSettingsCard({ card, onOpen, onReset, onDelete }: Props) {
  return (
    <article className="admission-settings-card">
      <button
        type="button"
        className="admission-settings-card-open"
        aria-label={`${card.name} 설정 열기`}
        onClick={() => onOpen(card.name)}
      />
      <header>
        <span>{card.name.trim().slice(0, 1) || "전"}</span>
        <div>
          <small>ADMISSION SETTINGS</small>
          <h3>{card.name}</h3>
        </div>
        <b>
          설정 열기 <i>→</i>
        </b>
      </header>
      <div className="admission-settings-card-summary">
        <dl>
          <div>
            <dt>등록 수험생</dt>
            <dd>{card.candidates.toLocaleString()}명</dd>
          </div>
          <div>
            <dt>시험 날짜</dt>
            <dd>{card.dates.toLocaleString()}일</dd>
          </div>
          <div>
            <dt>운영 일정</dt>
            <dd>{card.schedules.toLocaleString()}개</dd>
          </div>
        </dl>
        {card.setting ? <AdmissionSettingOverview setting={card.setting} /> : <UnavailableSetting />}
      </div>
      <footer>
        <div className="admission-settings-card-building">
          <span>고사건물</span>
          <strong>{card.buildings.length ? card.buildings.join(" · ") : "-"}</strong>
        </div>
        <div className="admission-settings-card-actions">
          <button type="button" onClick={() => onReset(card.name)}>
            <ResetButtonIcon />
            <span>초기화</span>
          </button>
          <button type="button" className="danger" onClick={() => onDelete(card.name)}>
            <DeleteButtonIcon />
            <span>삭제</span>
          </button>
        </div>
      </footer>
    </article>
  );
}

function AdmissionSettingOverview({ setting }: { setting: NonNullable<AdmissionCardData["setting"]> }) {
  return (
    <div className="admission-setting-overview">
      <div className="admission-setting-method">
        <span>가번호 부여 방식</span>
        <div>
          <strong>{assignmentMethodLabel(setting.assignmentMethod)}</strong>
          <small>{assignmentMethodDetail(setting)}</small>
        </div>
      </div>
      <div className="admission-setting-policy-grid">
        <SettingSummary
          label="등록 완료(마감)"
          value={setting.autoAssignAbsenteesOnClose ? "결시자 자동 부여" : "현재 상태 유지"}
          enabled={setting.autoAssignAbsenteesOnClose}
        />
        <SettingSummary
          label="마감 해제"
          value={setting.deleteAbsenteeInfoOnReopen ? "결시 정보 삭제" : "결시 정보 유지"}
          enabled={setting.deleteAbsenteeInfoOnReopen}
        />
        <SettingSummary
          label="수험생 사진"
          value={setting.useCandidatePhotos ? "사용" : "미사용"}
          enabled={setting.useCandidatePhotos}
        />
        <SettingSummary
          label="가번호 일괄 추첨"
          value={setting.assignmentMethod === "DRAW" ? (setting.enableBulkDraw ? "사용" : "미사용") : "해당 없음"}
          enabled={setting.assignmentMethod === "DRAW" && setting.enableBulkDraw}
          muted={setting.assignmentMethod !== "DRAW"}
        />
      </div>
      <div className="admission-setting-range-summary">
        <span>
          {setting.assignmentMethod === "DRAW" || setting.assignmentMethod === "SEQUENTIAL"
            ? "가번호 범위"
            : "부가 설정"}
        </span>
        <strong>{rangeSummary(setting)}</strong>
      </div>
    </div>
  );
}

function SettingSummary({
  label,
  value,
  enabled = false,
  muted = false,
}: {
  label: string;
  value: string;
  enabled?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`${enabled ? "enabled" : ""} ${muted ? "muted" : ""}`}>
      <span>{label}</span>
      <strong>
        <i />
        {value}
      </strong>
    </div>
  );
}

function UnavailableSetting() {
  return (
    <div className="admission-setting-unavailable">
      <strong>설정 확인 필요</strong>
      <span>카드를 열어 전형 설정을 확인해 주세요.</span>
    </div>
  );
}
