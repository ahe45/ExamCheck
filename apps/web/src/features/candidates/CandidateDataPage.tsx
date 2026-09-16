import { ToastNotice } from "../../shared/components/ToastNotice";
import { useCallback, useEffect, useState } from "react";
import { downloadCandidateData, fetchCandidates, type CandidateRecord } from "../../shared/api/candidates";
import { DownloadButtonIcon, RefreshButtonIcon, UploadButtonIcon } from "../../shared/components/ActionIcons";
import { CandidateDataGrid } from "./CandidateDataGrid";
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchCandidates(token));
    } catch (reason) {
      setError(messageOf(reason, "수험생 데이터를 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function downloadData() {
    setDownloadBusy(true);
    setError(null);
    try {
      await downloadCandidateData(token);
    } catch (reason) {
      setError(messageOf(reason, "파일을 다운로드하지 못했습니다."));
    } finally {
      setDownloadBusy(false);
    }
  }

  async function completeUpload(message: string) {
    setNotice(message);
    await load();
  }

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
        <CandidateDataGrid loading={loading} rows={rows} />
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
