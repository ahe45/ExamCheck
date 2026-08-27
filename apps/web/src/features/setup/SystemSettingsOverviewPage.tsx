import { useQuery, useQueryClient } from "@tanstack/react-query";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { fetchPseudonymSettingsOverview, type PseudonymSetting } from "../../shared/api/pseudonyms";
import { RefreshButtonIcon } from "../../shared/components/ActionIcons";
import { ToastNotice } from "../../shared/components/ToastNotice";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import { AdmissionSettingsCard } from "./AdmissionSettingsCard";
import { AdmissionSettingsEditorModal } from "./AdmissionSettingsEditorModal";
import type { AdmissionCardData } from "./system-settings-overview-model";
import type { SystemSettingsPageHandle } from "./SystemSettingsPage";

const DEFAULT_EXAM_NAME = import.meta.env.VITE_DEFAULT_EXAM_NAME || "2026년도 자격시험";
const SETTINGS_OVERVIEW_QUERY_KEY = ["pseudonym-settings-overview", DEFAULT_EXAM_NAME] as const;

interface Props {
  token: string;
  onDirtyChange?(dirty: boolean): void;
}

export const SystemSettingsOverviewPage = forwardRef<SystemSettingsPageHandle, Props>(
  function SystemSettingsOverviewPage({ token, onDirtyChange }, ref) {
    const queryClient = useQueryClient();
    const editorRef = useRef<SystemSettingsPageHandle>(null);
    const [selectedAdmission, setSelectedAdmission] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const [savingBeforeClose, setSavingBeforeClose] = useState(false);
    const [editorSaveState, setEditorSaveState] = useState({ canSave: false, saving: false });
    const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const overviewQuery = useQuery<AdmissionCardData[]>({
      queryKey: SETTINGS_OVERVIEW_QUERY_KEY,
      queryFn: () => fetchPseudonymSettingsOverview(token, DEFAULT_EXAM_NAME),
      enabled: Boolean(token),
      retry: false,
    });
    const cards = overviewQuery.data ?? [];
    const loading = overviewQuery.isFetching;
    const { refetch } = overviewQuery;
    const load = useCallback(async () => {
      setNotice(null);
      await refetch();
    }, [refetch]);
    const closeEditor = useCallback(() => {
      setSelectedAdmission(null);
      setDirty(false);
      setCloseConfirmOpen(false);
      setEditorSaveState({ canSave: false, saving: false });
    }, []);
    const requestClose = useCallback(() => {
      if (dirty) setCloseConfirmOpen(true);
      else closeEditor();
    }, [closeEditor, dirty]);

    useEffect(() => {
      if (!overviewQuery.error) return;
      setNotice(
        overviewQuery.error instanceof Error
          ? overviewQuery.error.message
          : "전형별 시스템 설정을 불러오지 못했습니다.",
      );
    }, [overviewQuery.error]);
    useEffect(() => {
      onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);
    useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

    useEscapeKey(Boolean(selectedAdmission) && !closeConfirmOpen, requestClose);
    useEscapeKey(closeConfirmOpen && !savingBeforeClose, () => setCloseConfirmOpen(false));

    useImperativeHandle(ref, () => ({
      save: async () => (editorRef.current ? editorRef.current.save() : true),
    }));

    function openAdmission(name: string) {
      setSelectedAdmission(name);
      setDirty(false);
      setCloseConfirmOpen(false);
      setEditorSaveState({ canSave: false, saving: false });
    }

    async function saveCurrentSettings() {
      if (!editorSaveState.canSave) return;
      await editorRef.current?.save();
    }

    async function saveAndClose() {
      if (savingBeforeClose) return;
      setSavingBeforeClose(true);
      const saved = await editorRef.current?.save();
      setSavingBeforeClose(false);
      if (saved) closeEditor();
    }

    function updateCardSetting(setting: PseudonymSetting) {
      queryClient.setQueryData<AdmissionCardData[]>(SETTINGS_OVERVIEW_QUERY_KEY, (current = []) =>
        current.map((card) => (card.name === setting.admissionName ? { ...card, setting, error: false } : card)),
      );
    }

    return (
      <section className="admin-standard-view admission-settings-overview">
        <header className="admin-view-heading admission-settings-overview-heading">
          <div>
            <h2>시스템 설정</h2>
            <p>등록된 수험생 데이터의 전형별로 가번호 부여 방식과 운영 정책을 관리합니다.</p>
          </div>
          <button type="button" className="exam-outline-button" onClick={() => void load()} disabled={loading}>
            <RefreshButtonIcon />
            <span>{loading ? "불러오는 중…" : "새로고침"}</span>
          </button>
        </header>

        {notice && <ToastNotice notice={{ kind: "error", text: notice }} onClose={() => setNotice(null)} />}
        {loading ? (
          <div className="admin-view-loading">등록된 전형과 설정 정보를 불러오고 있습니다.</div>
        ) : cards.length ? (
          <div className="admission-settings-card-grid">
            {cards.map((card) => (
              <AdmissionSettingsCard card={card} key={card.name} onOpen={openAdmission} />
            ))}
          </div>
        ) : (
          <div className="admission-settings-empty">
            <span>!</span>
            <strong>등록된 전형이 없습니다.</strong>
            <p>수험생 데이터 메뉴에서 데이터를 업로드하면 전형 설정 카드가 자동으로 생성됩니다.</p>
          </div>
        )}

        {selectedAdmission && (
          <AdmissionSettingsEditorModal
            token={token}
            admissionName={selectedAdmission}
            editorRef={editorRef}
            saveState={editorSaveState}
            closeConfirmOpen={closeConfirmOpen}
            savingBeforeClose={savingBeforeClose}
            onDirtyChange={setDirty}
            onSaveStateChange={setEditorSaveState}
            onSaved={updateCardSetting}
            onRequestClose={requestClose}
            onCancelClose={() => setCloseConfirmOpen(false)}
            onDiscard={closeEditor}
            onSave={() => void saveCurrentSettings()}
            onSaveAndClose={() => void saveAndClose()}
          />
        )}
      </section>
    );
  },
);
