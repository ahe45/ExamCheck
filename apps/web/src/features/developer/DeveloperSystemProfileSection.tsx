import { useRef } from "react";
import type { DeveloperSettings, DeveloperSettingsInput } from "../../shared/api/developer-settings";
import {
  DeleteButtonIcon,
  ImageButtonIcon,
  KeyButtonIcon,
  RefreshButtonIcon,
  SaveButtonIcon,
} from "../../shared/components/ActionIcons";
import { DeveloperImageIcon, DeveloperPreviewIcon, DeveloperSchoolIcon } from "./DeveloperSettingsIcons";

interface DeveloperSettingsFormHeaderProps {
  loading: boolean;
  saving: boolean;
  logoBusy: boolean;
  dirty: boolean;
  onOpenPassword(): void;
  onRefresh(): void;
}

export function DeveloperSettingsFormHeader({
  loading,
  saving,
  logoBusy,
  dirty,
  onOpenPassword,
  onRefresh,
}: DeveloperSettingsFormHeaderProps) {
  return (
    <header>
      <span className="developer-section-icon">
        <DeveloperSchoolIcon />
      </span>
      <div>
        <h3>시스템 기본 정보</h3>
        <p>서비스 전역에서 사용할 기본 정보와 번호 유일 정책을 설정합니다.</p>
      </div>
      <div className="developer-heading-actions">
        <button className="exam-ghost-button" type="button" onClick={onOpenPassword}>
          <KeyButtonIcon />
          <span>비밀번호 변경</span>
        </button>
        <button
          className="exam-outline-button"
          type="button"
          onClick={onRefresh}
          disabled={loading || saving || logoBusy}
        >
          <RefreshButtonIcon />
          <span>새로고침</span>
        </button>
        <button className="exam-primary-button" type="submit" disabled={!dirty || saving || logoBusy}>
          <SaveButtonIcon />
          <span>{saving ? "저장 중…" : "설정 저장"}</span>
        </button>
      </div>
    </header>
  );
}

interface DeveloperSystemProfileSectionProps {
  profile: DeveloperSettings | null;
  form: DeveloperSettingsInput;
  logoBusy: boolean;
  onFormChange(patch: Partial<DeveloperSettingsInput>): void;
  onLogoSelected(file: File): void;
  onRemoveLogo(): void;
}

export function DeveloperSystemProfileSection({
  profile,
  form,
  logoBusy,
  onFormChange,
  onLogoSelected,
  onRemoveLogo,
}: DeveloperSystemProfileSectionProps) {
  const logoInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <div className="developer-profile-editor">
        <div className="developer-field-grid">
          <label>
            <span>학교명</span>
            <input
              required
              maxLength={200}
              value={form.schoolName}
              onChange={(event) => onFormChange({ schoolName: event.target.value })}
              placeholder="예: 한국대학교"
            />
          </label>
          <label>
            <span>학년도</span>
            <div className="developer-year-input">
              <input
                required
                type="number"
                min={2000}
                max={2100}
                value={form.academicYear}
                onChange={(event) => onFormChange({ academicYear: Number(event.target.value) })}
              />
              <i>학년도</i>
            </div>
          </label>
          <label className="developer-wide-field">
            <span>시스템 명칭</span>
            <input
              required
              maxLength={200}
              value={form.systemName}
              onChange={(event) => onFormChange({ systemName: event.target.value })}
              placeholder="가번호 관리 시스템"
            />
          </label>
        </div>
        <section className="developer-inline-logo-section">
          <header>
            <span className="developer-section-icon">
              <DeveloperImageIcon />
            </span>
            <div>
              <h4>시스템 로고</h4>
              <p>PNG, JPG, WEBP · 최대 2MB</p>
            </div>
          </header>
          <div className="developer-logo-body">
            <div className={`developer-logo-preview ${profile?.logoDataUrl ? "has-image" : ""}`}>
              {profile?.logoDataUrl ? (
                <img src={profile.logoDataUrl} alt="현재 시스템 로고" />
              ) : (
                <span>
                  <b>가</b>
                  <small>등록된 로고가 없습니다.</small>
                </span>
              )}
            </div>
            <div className="developer-logo-actions">
              <strong>{profile?.logoFileName || "기본 로고 사용 중"}</strong>
              <p>가로형 또는 심볼형 로고를 권장합니다.</p>
              <div>
                <button
                  type="button"
                  className="exam-outline-button"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={logoBusy}
                >
                  <ImageButtonIcon />
                  <span>{logoBusy ? "처리 중…" : profile?.logoDataUrl ? "로고 변경" : "로고 업로드"}</span>
                </button>
                <button
                  type="button"
                  className="exam-ghost-button"
                  onClick={onRemoveLogo}
                  disabled={!profile?.logoDataUrl || logoBusy}
                >
                  <DeleteButtonIcon />
                  <span>삭제</span>
                </button>
              </div>
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onLogoSelected(file);
              }}
              hidden
            />
          </div>
        </section>
      </div>
      <aside className="developer-inline-preview">
        <header>
          <span className="developer-section-icon">
            <DeveloperPreviewIcon />
          </span>
          <div>
            <h4>표시 미리보기</h4>
            <p>입력한 정보가 시스템에 표시되는 형태입니다.</p>
          </div>
        </header>
        <div className="developer-brand-preview">
          <span className="developer-brand-preview-logo">
            {profile?.logoDataUrl ? <img src={profile.logoDataUrl} alt="" /> : "가"}
          </span>
          <span>
            <small>
              {form.academicYear}학년도 · {form.schoolName || "학교명"}
            </small>
            <strong>{form.systemName || "시스템 명칭"}</strong>
          </span>
        </div>
        <p className="developer-preview-help">
          로고 변경은 즉시 저장되며, 학교·학년도·시스템 명칭은 설정 저장 후 반영됩니다.
        </p>
      </aside>
    </>
  );
}
