import { useQuery, useQueryClient } from "@tanstack/react-query";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { fetchPseudonymSettingsOverview, type PseudonymSetting } from "../../shared/api/pseudonyms";
import { RefreshButtonIcon, SettingsButtonIcon } from "../../shared/components/ActionIcons";
import { classificationLabels, type ClassificationMethod } from "../../shared/classification";
import { ToastNotice, type ToastNoticeValue } from "../../shared/components/ToastNotice";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import { AdmissionSettingsCard } from "./AdmissionSettingsCard";
import { AdmissionDeleteModal, AdmissionOperationsResetModal } from "./AdmissionDataActionModals";
import { AdmissionSettingsEditorModal } from "./AdmissionSettingsEditorModal";
import type { AdmissionCardData } from "./system-settings-overview-model";
import type { SettingsScope, SystemSettingsPageHandle } from "./SystemSettingsPage";

const DEFAULT_EXAM_NAME = import.meta.env.VITE_DEFAULT_EXAM_NAME || "2026년도 자격시험";

interface Props {
  token: string;
  classificationMethod?: ClassificationMethod;
  onDirtyChange?(dirty: boolean): void;
}

export const SystemSettingsOverviewPage = forwardRef<SystemSettingsPageHandle, Props>(
  function SystemSettingsOverviewPage({ token, classificationMethod = "ADMISSION", onDirtyChange }, ref) {
    const overviewQueryKey = ["pseudonym-settings-overview", DEFAULT_EXAM_NAME, classificationMethod] as const;
    const queryClient = useQueryClient();
    const editorRef = useRef<SystemSettingsPageHandle>(null);
    const [editorTarget, setEditorTarget] = useState<{
      name: string;
      label?: string;
      batchScopes?: SettingsScope[];
    } | null>(null);
    const [resetAdmissionName, setResetAdmissionName] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<{ card: AdmissionCardData; scopeLabel?: string } | null>(null);
    const [dirty, setDirty] = useState(false);
    const [savingBeforeClose, setSavingBeforeClose] = useState(false);
    const [editorSaveState, setEditorSaveState] = useState({ canSave: false, saving: false });
    const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
    const [notice, setNotice] = useState<ToastNoticeValue | null>(null);
    const overviewQuery = useQuery<AdmissionCardData[]>({
      queryKey: overviewQueryKey,
      queryFn: () => fetchPseudonymSettingsOverview(token, DEFAULT_EXAM_NAME),
      enabled: Boolean(token),
      retry: false,
    });
    const cards = overviewQuery.data ?? [];
    const activeMethod = cards[0]?.classificationMethod ?? classificationMethod;
    const classified = activeMethod !== "ADMISSION";
    const loading = overviewQuery.isFetching;
    const { refetch } = overviewQuery;
    const load = useCallback(async () => {
      setNotice(null);
      await refetch();
    }, [refetch]);
    const closeEditor = useCallback(() => {
      setEditorTarget(null);
      setDirty(false);
      setCloseConfirmOpen(false);
      setEditorSaveState({ canSave: false, saving: false });
    }, []);
    const requestClose = useCallback(() => {
      if (editorSaveState.saving || savingBeforeClose) return;
      if (dirty) setCloseConfirmOpen(true);
      else closeEditor();
    }, [closeEditor, dirty, editorSaveState.saving, savingBeforeClose]);

    useEffect(() => {
      if (!overviewQuery.error) return;
      setNotice({
        kind: "error",
        text:
          overviewQuery.error instanceof Error
            ? overviewQuery.error.message
            : "전형별 시스템 설정을 불러오지 못했습니다.",
      });
    }, [overviewQuery.error]);
    useEffect(() => {
      onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);
    useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

    useEscapeKey(Boolean(editorTarget) && !closeConfirmOpen, requestClose);
    useEscapeKey(closeConfirmOpen && !savingBeforeClose, () => setCloseConfirmOpen(false));

    useImperativeHandle(ref, () => ({
      save: async () => (editorRef.current ? editorRef.current.save() : true),
    }));

    function openEditor(target: NonNullable<typeof editorTarget>) {
      setEditorTarget(target);
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

    function updateCardSettings(settings: PseudonymSetting[]) {
      const byScope = new Map(settings.map((setting) => [setting.admissionName, setting]));
      queryClient.setQueryData<AdmissionCardData[]>(overviewQueryKey, (current = []) =>
        current.map((card) => {
          const setting = byScope.get(card.name);
          return setting ? { ...card, setting, error: false } : card;
        }),
      );
    }

    function completeOperationReset(scheduleCount: number, assignmentCount: number) {
      setResetAdmissionName(null);
      setNotice({
        kind: "success",
        text: `선택한 교시 ${scheduleCount.toLocaleString()}개의 운영 이력을 초기화했습니다. 가번호 배정 ${assignmentCount.toLocaleString()}건을 삭제했습니다.`,
      });
      void refetch();
    }

    function completeAdmissionDelete(admissionName: string, label: string, candidateCount: number) {
      setDeleteTarget(null);
      queryClient.setQueryData<AdmissionCardData[]>(overviewQueryKey, (current = []) =>
        current.filter((card) => card.name !== admissionName),
      );
      setNotice({
        kind: "success",
        text: `${label}의 수험생 ${candidateCount.toLocaleString()}명의 데이터를 삭제했습니다.`,
      });
      void refetch();
    }

    return (
      <section className="admin-standard-view admission-settings-overview">
        <header className="admin-view-heading admission-settings-overview-heading">
          <div>
            <h2>시스템 설정</h2>
            <p>가번호 부여 방식과 운영 정책을 관리합니다. 분류 방법은 {classificationLabels[activeMethod]}입니다.</p>
          </div>
          <div className="admin-view-actions">
            <button
              type="button"
              className="exam-outline-button"
              disabled={loading || !cards.length || overviewQuery.isError}
              onClick={() => {
                const batchScopes = cards.map(({ name, label }) => ({ key: name, label: label ?? name }));
                const first = batchScopes[0];
                openEditor({ name: first.key, label: first.label, batchScopes });
              }}
            >
              <SettingsButtonIcon />
              <span>일괄 설정</span>
            </button>
            <button type="button" className="exam-outline-button" onClick={() => void load()} disabled={loading}>
              <RefreshButtonIcon />
              <span>{loading ? "불러오는 중…" : "새로고침"}</span>
            </button>
          </div>
        </header>

        {notice && <ToastNotice notice={notice} onClose={() => setNotice(null)} />}
        {loading ? (
          <div className="admin-view-loading">등록된 분류와 설정 정보를 불러오고 있습니다.</div>
        ) : cards.length ? (
          <div className="admission-settings-card-grid">
            {cards.map((card) => (
              <AdmissionSettingsCard
                card={card}
                key={card.name}
                onOpen={(name) => openEditor({ name, label: classified ? card.label : undefined })}
                onReset={setResetAdmissionName}
                onDelete={() =>
                  setDeleteTarget({ card, scopeLabel: classified ? (card.label ?? card.name) : undefined })
                }
              />
            ))}
          </div>
        ) : (
          <div className="admission-settings-empty">
            <span>!</span>
            <strong>등록된 수험생이 없습니다.</strong>
            <p>수험생 데이터를 업로드하면 선택한 분류 기준에 따라 설정 카드가 생성됩니다.</p>
          </div>
        )}

        {editorTarget && (
          <AdmissionSettingsEditorModal
            token={token}
            admissionName={editorTarget.name}
            scopeLabel={editorTarget.label}
            batchScopes={editorTarget.batchScopes}
            editorRef={editorRef}
            saveState={editorSaveState}
            closeConfirmOpen={closeConfirmOpen}
            savingBeforeClose={savingBeforeClose}
            onDirtyChange={setDirty}
            onSaveStateChange={setEditorSaveState}
            onSaved={updateCardSettings}
            onRequestClose={requestClose}
            onCancelClose={() => setCloseConfirmOpen(false)}
            onDiscard={closeEditor}
            onSave={() => void saveCurrentSettings()}
            onSaveAndClose={() => void saveAndClose()}
          />
        )}
        {resetAdmissionName && (
          <AdmissionOperationsResetModal
            token={token}
            examName={DEFAULT_EXAM_NAME}
            admissionName={resetAdmissionName}
            scopeLabel={classified ? cards.find((card) => card.name === resetAdmissionName)?.label : undefined}
            onClose={() => setResetAdmissionName(null)}
            onCompleted={completeOperationReset}
          />
        )}
        {deleteTarget && (
          <AdmissionDeleteModal
            token={token}
            admissionName={deleteTarget.card.name}
            scopeLabel={deleteTarget.scopeLabel}
            candidateCount={deleteTarget.card.candidates}
            onClose={() => setDeleteTarget(null)}
            onCompleted={(candidateCount) =>
              completeAdmissionDelete(
                deleteTarget.card.name,
                deleteTarget.scopeLabel ?? `${deleteTarget.card.name} 전형`,
                candidateCount,
              )
            }
          />
        )}
      </section>
    );
  },
);
