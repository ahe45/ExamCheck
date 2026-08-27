import type { DeveloperSettingsInput } from "../../shared/api/developer-settings";
import { DeveloperPolicyIcon } from "./DeveloperSettingsIcons";

interface Props {
  form: DeveloperSettingsInput;
  disabled: boolean;
  onFormChange(patch: Partial<DeveloperSettingsInput>): void;
}

export function DeveloperUniquenessPolicySection({ form, disabled, onFormChange }: Props) {
  return (
    <section className="developer-uniqueness-section" aria-labelledby="developer-uniqueness-title">
      <header>
        <span className="developer-section-icon">
          <DeveloperPolicyIcon />
        </span>
        <div>
          <h4 id="developer-uniqueness-title">번호 유일 정책</h4>
          <p>수험번호와 가번호의 중복을 허용할 운영 범위를 설정합니다.</p>
        </div>
      </header>
      <div className="developer-policy-grid">
        <fieldset disabled={disabled}>
          <legend>수험번호 유일 정책</legend>
          <p>동일한 수험번호를 다시 등록할 수 있는 범위입니다.</p>
          <div className="developer-policy-options">
            <label className={form.examineeNoUniqueness === "SYSTEM" ? "selected" : ""}>
              <input
                type="radio"
                name="examinee-number-uniqueness"
                value="SYSTEM"
                checked={form.examineeNoUniqueness === "SYSTEM"}
                onChange={() => onFormChange({ examineeNoUniqueness: "SYSTEM" })}
              />
              <span>
                <strong>시스템 전체</strong>
                <small>모든 전형·날짜·교시를 포함해 수험번호를 한 번만 사용합니다.</small>
              </span>
            </label>
            <label className={form.examineeNoUniqueness === "SCHEDULE" ? "selected" : ""}>
              <input
                type="radio"
                name="examinee-number-uniqueness"
                value="SCHEDULE"
                checked={form.examineeNoUniqueness === "SCHEDULE"}
                onChange={() => onFormChange({ examineeNoUniqueness: "SCHEDULE" })}
              />
              <span>
                <strong>교시별</strong>
                <small>동일한 성명·생년월일인 수험생은 다른 날짜·교시에서 같은 수험번호를 사용할 수 있습니다.</small>
              </span>
            </label>
          </div>
        </fieldset>
        <fieldset disabled={disabled}>
          <legend>가번호 유일 정책</legend>
          <p>동일한 가번호를 다시 부여할 수 있는 범위입니다.</p>
          <div className="developer-policy-options">
            <label className={form.pseudonymNoUniqueness === "ADMISSION" ? "selected" : ""}>
              <input
                type="radio"
                name="pseudonym-number-uniqueness"
                value="ADMISSION"
                checked={form.pseudonymNoUniqueness === "ADMISSION"}
                onChange={() => onFormChange({ pseudonymNoUniqueness: "ADMISSION" })}
              />
              <span>
                <strong>전형 전체</strong>
                <small>같은 전형의 모든 날짜·교시에서 가번호를 중복하여 부여하지 않습니다.</small>
              </span>
            </label>
            <label className={form.pseudonymNoUniqueness === "SCHEDULE" ? "selected" : ""}>
              <input
                type="radio"
                name="pseudonym-number-uniqueness"
                value="SCHEDULE"
                checked={form.pseudonymNoUniqueness === "SCHEDULE"}
                onChange={() => onFormChange({ pseudonymNoUniqueness: "SCHEDULE" })}
              />
              <span>
                <strong>교시별</strong>
                <small>같은 교시 안에서만 유일하며, 서로 다른 일정에서는 재사용할 수 있습니다.</small>
              </span>
            </label>
          </div>
        </fieldset>
      </div>
      <p className="developer-policy-help">정책을 변경하면 기존 데이터와의 충돌 여부를 확인한 뒤 저장됩니다.</p>
    </section>
  );
}
