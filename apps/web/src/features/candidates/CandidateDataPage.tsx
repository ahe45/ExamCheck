import { ToastNotice } from "../../shared/components/ToastNotice";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  downloadCandidateData,
  fetchCandidatePage,
  fetchCandidateFilterValues,
  type CandidateRecord,
  type CandidateFieldKey,
} from "../../shared/api/candidates";
import { DownloadButtonIcon, RefreshButtonIcon, UploadButtonIcon } from "../../shared/components/ActionIcons";
import { CandidateDataGrid } from "./CandidateDataGrid";
import { useClientDataGrid } from "../../shared/hooks/useClientDataGrid";
import { candidateColumnValue } from "./candidate-data-model";
import { messageOf } from "./candidate-data-model";
import { CandidateUploadModal } from "./CandidateUploadModal";

interface Props {
  token: string;
}

export function CandidateDataPage({ token }: Props) {
  const [rows, setRows] = useState<CandidateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);

  const [total, setTotal] = useState(0);
  const [revision, setRevision] = useState(0);
  const facets = useRef(new Map<CandidateFieldKey, Promise<string[]>>());
  const loadValues = useCallback(
    (key: CandidateFieldKey) => {
      let pending = facets.current.get(key);
      if (!pending) {
        pending = fetchCandidateFilterValues(token, key).catch((error) => {
          facets.current.delete(key);
          throw error;
        });
        facets.current.set(key, pending);
      }
      return pending;
    },
    [token],
  );
  const onError = useCallback((reason: unknown) => setError(messageOf(reason, "조회하지 못했습니다.")), []);
  const server = useMemo(() => ({ total, loadValues, onError }), [total, loadValues, onError]);
  const grid = useClientDataGrid<CandidateRecord, CandidateFieldKey>({ rows, valueOf: candidateColumnValue, server });
  const setPage = grid.setPage;
  const query = useMemo(
    () => ({ page: grid.page, pageSize: grid.pageSize, sort: grid.sort, filters: grid.filters }),
    [grid.page, grid.pageSize, grid.sort, grid.filters],
  );
  const load = useCallback(() => {
    facets.current.clear();
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    facets.current.clear();
  }, [token]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchCandidatePage(token, query, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setRows(result.rows);
        setTotal(result.total);
        if (result.page !== query.page) setPage(result.page);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) onError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, query, revision, onError, setPage]);

  async function downloadData() {
    setDownloadBusy(true);
    setError(null);
    try {
      await downloadCandidateData(token, query);
    } catch (reason) {
      setError(messageOf(reason, "파일을 다운로드하지 못했습니다."));
    } finally {
      setDownloadBusy(false);
    }
  }

  const completeUpload = useCallback(
    async (message: string) => {
      setNotice(message);
      load();
    },
    [load],
  );

  return (
    <section className="candidate-data-view">
      <article className="candidate-data-card">
        <header className="candidate-data-header">
          <div>
            <h2>수험생 데이터</h2>
            <p>업로드된 수험생 데이터를 확인하고, 열별로 정렬하거나 필요한 값만 필터링합니다.</p>
          </div>
          <div className="candidate-data-actions">
            <button className="exam-outline-button" onClick={() => void load()} disabled={loading}>
              <RefreshButtonIcon />
              <span>{loading ? "불러오는 중…" : "새로고침"}</span>
            </button>
            <button
              className="exam-outline-button"
              onClick={() => void downloadData()}
              disabled={downloadBusy || !rows.length}
            >
              <DownloadButtonIcon />
              <span>다운로드</span>
            </button>
            <button
              className="exam-primary-button"
              onClick={() => {
                setUploadOpen(true);
                setError(null);
              }}
            >
              <UploadButtonIcon />
              <span>데이터 업로드</span>
            </button>
          </div>
        </header>
        {notice && <ToastNotice notice={{ kind: "success", text: notice }} onClose={() => setNotice(null)} />}
        {error && !uploadOpen && <ToastNotice notice={{ kind: "error", text: error }} onClose={() => setError(null)} />}
        <CandidateDataGrid loading={loading} grid={grid} />
      </article>

      <CandidateUploadModal
        open={uploadOpen}
        token={token}
        onClose={() => setUploadOpen(false)}
        onComplete={completeUpload}
      />
    </section>
  );
}
