import { useToastAutoDismiss } from "../hooks/useToastAutoDismiss";

export interface ToastNoticeValue {
  kind: "success" | "error";
  text: string;
}

export function ToastNotice({ notice, onClose }: { notice: ToastNoticeValue; onClose(): void }) {
  const lifecycle = useToastAutoDismiss({
    enabled: true,
    resetKey: `${notice.kind}:${notice.text}`,
    onClose,
  });
  return (
    <div
      className={`system-settings-notice ${notice.kind}${lifecycle.fading ? " is-fading" : ""}`}
      role={notice.kind === "error" ? "alert" : "status"}
      aria-live={notice.kind === "error" ? "assertive" : "polite"}
      onMouseEnter={lifecycle.onMouseEnter}
      onMouseLeave={lifecycle.onMouseLeave}
    >
      <i aria-hidden="true">{notice.kind === "success" ? "✓" : "!"}</i>
      <span>{notice.text}</span>
      <button type="button" onClick={onClose} aria-label="알림 닫기">
        ×
      </button>
    </div>
  );
}
