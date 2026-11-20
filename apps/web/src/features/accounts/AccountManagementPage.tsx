import { useCallback, useEffect, useState } from "react";
import {
  createAccount,
  deleteAccount,
  fetchAccountScopes,
  fetchAccounts,
  updateAccount,
  type Account,
  type AccountInput,
  type AccountScopeOptions,
} from "../../shared/api/accounts";
import { classificationLabels } from "../../shared/classification";
import { AddButtonIcon, RefreshButtonIcon } from "../../shared/components/ActionIcons";
import { ToastNotice } from "../../shared/components/ToastNotice";
import { AccountDataGrid } from "./AccountDataGrid";
import { AccountDeleteModal } from "./AccountDeleteModal";
import { AccountEditorModal } from "./AccountEditorModal";

interface Props {
  token: string;
  currentUserId: number;
}

export function AccountManagementPage({ token, currentUserId }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [scopeOptions, setScopeOptions] = useState<AccountScopeOptions>({ method: "ADMISSION", scopes: [] });
  const scopeLabels = Object.fromEntries(scopeOptions.scopes.map(({ key, label }) => [key, label]));
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const [nextAccounts, nextScopes] = await Promise.all([fetchAccounts(token), fetchAccountScopes(token)]);
      setAccounts(nextAccounts);
      setScopeOptions(nextScopes);
    } catch (reason) {
      setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "계정 정보를 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchAccounts(token)
        .then(setAccounts)
        .catch(() => {});
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [token]);

  function openCreate() {
    setEditing(null);
    setNotice(null);
    setEditorOpen(true);
  }

  function openEdit(account: Account) {
    setEditing(account);
    setNotice(null);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditing(null);
  }

  async function saveAccount(account: Account | null, input: AccountInput) {
    setNotice(null);
    try {
      const scopedInput = { ...input, classificationMethod: scopeOptions.method };
      if (account) await updateAccount(token, account.id, scopedInput);
      else await createAccount(token, { ...scopedInput, password: input.password || "" });
      closeEditor();
      await load();
      setNotice({ kind: "success", text: account ? "계정 정보가 수정되었습니다." : "새 계정이 생성되었습니다." });
      return true;
    } catch (reason) {
      setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "계정 정보를 저장하지 못했습니다." });
      return false;
    }
  }

  async function removeAccount(account: Account) {
    setNotice(null);
    try {
      await deleteAccount(token, account.id);
      setDeleteTarget(null);
      await load();
      setNotice({ kind: "success", text: "계정이 삭제되었습니다." });
      return true;
    } catch (reason) {
      setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "계정을 삭제하지 못했습니다." });
      return false;
    }
  }

  return (
    <section className="candidate-data-view account-management-view">
      <article className="candidate-data-card">
        <header className="candidate-data-header">
          <div>
            <h2>계정 관리</h2>
            <p>
              계정과 사용자별 접근 범위를 관리합니다. 분류 방법은 {classificationLabels[scopeOptions.method]}입니다.
            </p>
          </div>
          <div className="candidate-data-actions">
            <button className="exam-outline-button" onClick={() => void load()} disabled={loading}>
              <RefreshButtonIcon />
              <span>{loading ? "불러오는 중…" : "새로고침"}</span>
            </button>
            <button className="exam-primary-button" onClick={openCreate}>
              <AddButtonIcon />
              <span>계정 생성</span>
            </button>
          </div>
        </header>
        {notice && <ToastNotice notice={notice} onClose={() => setNotice(null)} />}
        <AccountDataGrid
          accounts={accounts}
          scopeLabels={scopeLabels}
          currentUserId={currentUserId}
          loading={loading}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
        />
      </article>

      {editorOpen && (
        <AccountEditorModal
          admissions={scopeOptions.scopes.map(({ key }) => key)}
          scopeLabels={scopeLabels}
          classificationMethod={scopeOptions.method}
          editing={editing}
          onClose={closeEditor}
          onSave={saveAccount}
          onValidationError={(text) => setNotice({ kind: "error", text })}
        />
      )}

      {deleteTarget && (
        <AccountDeleteModal account={deleteTarget} onClose={() => setDeleteTarget(null)} onDelete={removeAccount} />
      )}
    </section>
  );
}
