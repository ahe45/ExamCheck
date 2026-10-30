import { useCallback } from "react";
import { createPortal } from "react-dom";
import type { CandidateAttendanceRecord } from "../../shared/api/candidates";
import { ModalCloseButton } from "../../shared/components/ModalCloseButton";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { useEscapeKey } from "../../shared/hooks/useEscapeKey";
import AttendanceStatusPage from "../attendance/AttendanceStatusPage";
import { dashboardGroupName, type DashboardBreakdown } from "./dashboard-statistics";
import "./dashboard-candidates-modal.css";

export function DashboardCandidatesModal({
  token,
  breakdown,
  name,
  onClose,
}: {
  token: string;
  breakdown: DashboardBreakdown;
  name: string;
  onClose(): void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(true);
  useEscapeKey(true, onClose);
  const recordFilter = useCallback(
    (record: CandidateAttendanceRecord) => dashboardGroupName(record, breakdown) === name,
    [breakdown, name],
  );
  return createPortal(
    <div
      className="dashboard-candidates-overlay"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dashboard-candidates-title"
    >
      <section className="dashboard-candidates-modal">
        <header className="dashboard-candidates-heading">
          <h2 id="dashboard-candidates-title">{name} · 수험생 목록</h2>
          <ModalCloseButton onClick={onClose} />
        </header>
        <AttendanceStatusPage token={token} view="candidate" recordFilter={recordFilter} />
      </section>
    </div>,
    document.body,
  );
}
