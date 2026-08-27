export interface ToastNoticeValue {
  kind: "success" | "error";
  text: string;
}

export function ToastNotice({ notice, onClose }: { notice: ToastNoticeValue; onClose(): void }) {
  return (
    <div
      className={`system-settings-notice ${notice.kind}`}
      role={notice.kind === "error" ? "alert" : "status"}
      aria-live={notice.kind === "error" ? "assertive" : "polite"}
    >
      <i aria-hidden="true">{notice.kind === "success" ? "✓" : "!"}</i>
      <span>{notice.text}</span>
      <button type="button" onClick={onClose} aria-label="알림 닫기">
        ×
      </button>
    </div>
  );
}
