import { useCallback, useEffect, useMemo, useState } from "react";
import {
  changeDeveloperPassword,
  fetchDeveloperSettings,
  removeDeveloperLogo,
  updateDeveloperSettings,
  uploadDeveloperLogo,
  type DeveloperSettings,
  type DeveloperSettingsInput,
} from "../../shared/api/developer-settings";
import {
  buildDeveloperSettingsInput,
  EMPTY_DEVELOPER_PASSWORD_FORM,
  EMPTY_DEVELOPER_SETTINGS_FORM,
  isDeveloperSettingsDirty,
  toDeveloperSettingsForm,
  validateDeveloperLogo,
  validateDeveloperPassword,
  type DeveloperPasswordForm,
  type DeveloperSettingsNotice,
} from "./developer-settings-model";

interface Options {
  token: string;
  onProfileChange?(profile: DeveloperSettings): void;
}

export function useDeveloperSettingsController({ token, onProfileChange }: Options) {
  const [profile, setProfile] = useState<DeveloperSettings | null>(null);
  const [form, setForm] = useState<DeveloperSettingsInput>(EMPTY_DEVELOPER_SETTINGS_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [notice, setNotice] = useState<DeveloperSettingsNotice | null>(null);
  const [password, setPassword] = useState<DeveloperPasswordForm>(EMPTY_DEVELOPER_PASSWORD_FORM);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<DeveloperSettingsNotice | null>(null);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const dirty = useMemo(() => isDeveloperSettingsDirty(profile, form), [form, profile]);

  const applyProfile = useCallback(
    (next: DeveloperSettings) => {
      setProfile(next);
      setForm(toDeveloperSettingsForm(next));
      onProfileChange?.(next);
    },
    [onProfileChange],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      applyProfile(await fetchDeveloperSettings(token));
    } catch (reason) {
      setNotice({
        kind: "error",
        text: reason instanceof Error ? reason.message : "개발자 설정을 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  }, [applyProfile, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateForm = useCallback((patch: Partial<DeveloperSettingsInput>) => {
    setForm((current) => ({ ...current, ...patch }));
  }, []);

  const updatePassword = useCallback((patch: Partial<DeveloperPasswordForm>) => {
    setPassword((current) => ({ ...current, ...patch }));
  }, []);

  const openPasswordModal = useCallback(() => setPasswordModalOpen(true), []);
  const closePasswordModal = useCallback(() => {
    if (passwordSaving) return;
    setPasswordModalOpen(false);
    setPassword(EMPTY_DEVELOPER_PASSWORD_FORM);
    setPasswordNotice(null);
  }, [passwordSaving]);

  async function saveSettings() {
    if (!dirty || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      applyProfile(await updateDeveloperSettings(token, buildDeveloperSettingsInput(form)));
      setNotice({ kind: "success", text: "시스템 설정이 저장되었습니다." });
    } catch (reason) {
      setNotice({
        kind: "error",
        text: reason instanceof Error ? reason.message : "시스템 설정을 저장하지 못했습니다.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function selectLogo(file: File) {
    if (logoBusy) return;
    const validationError = validateDeveloperLogo(file);
    if (validationError) {
      setNotice({ kind: "error", text: validationError });
      return;
    }
    setLogoBusy(true);
    setNotice(null);
    try {
      applyProfile(await uploadDeveloperLogo(token, file));
      setNotice({ kind: "success", text: "시스템 로고가 적용되었습니다." });
    } catch (reason) {
      setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "로고를 업로드하지 못했습니다." });
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    if (!profile?.logoDataUrl || logoBusy) return;
    setLogoBusy(true);
    setNotice(null);
    try {
      applyProfile(await removeDeveloperLogo(token));
      setNotice({ kind: "success", text: "시스템 로고가 삭제되었습니다." });
    } catch (reason) {
      setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "로고를 삭제하지 못했습니다." });
    } finally {
      setLogoBusy(false);
    }
  }

  async function savePassword() {
    if (passwordSaving) return;
    const validationError = validateDeveloperPassword(password);
    if (validationError) {
      setPasswordNotice({ kind: "error", text: validationError });
      return;
    }
    setPasswordSaving(true);
    setPasswordNotice(null);
    try {
      await changeDeveloperPassword(token, {
        currentPassword: password.current,
        newPassword: password.next,
      });
      setPassword(EMPTY_DEVELOPER_PASSWORD_FORM);
      setPasswordNotice({ kind: "success", text: "개발자 계정 비밀번호가 변경되었습니다." });
    } catch (reason) {
      setPasswordNotice({
        kind: "error",
        text: reason instanceof Error ? reason.message : "비밀번호를 변경하지 못했습니다.",
      });
    } finally {
      setPasswordSaving(false);
    }
  }

  return {
    profile,
    form,
    loading,
    saving,
    logoBusy,
    notice,
    dirty,
    password,
    passwordSaving,
    passwordNotice,
    passwordModalOpen,
    updateForm,
    updatePassword,
    refresh: load,
    saveSettings,
    selectLogo,
    removeLogo,
    openPasswordModal,
    closePasswordModal,
    savePassword,
    dismissNotice: () => setNotice(null),
  };
}
