import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useToastAutoDismiss } from "../hooks/useToastAutoDismiss";

export interface ToastNoticeValue {
  kind: "success" | "error";
  text: string;
}

interface ToastNoticeProps {
  notice: ToastNoticeValue;
  onClose?(): void;
}

export function ToastNotice(props: ToastNoticeProps) {
  return <ToastMessage key={`${props.notice.kind}:${props.notice.text}`} {...props} />;
}

function ToastMessage({ notice, onClose }: ToastNoticeProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useLayoutEffect(() => {
    if (dismissed) return;
    let viewport = document.querySelector<HTMLElement>("[data-app-toast-viewport]");
    if (!viewport) {
      viewport = document.createElement("div");
      viewport.className = "app-toast-viewport";
      viewport.setAttribute("data-app-toast-viewport", "");
      document.body.appendChild(viewport);
    }
    const slot = document.createElement("div");
    viewport.appendChild(slot);
    setHost(slot);
    return () => {
      slot.remove();
      if (!viewport.childElementCount) viewport.remove();
    };
  }, [dismissed]);

  function dismiss() {
    setDismissed(true);
    onClose?.();
  }

  const lifecycle = useToastAutoDismiss({
    enabled: !dismissed,
    resetKey: `${notice.kind}:${notice.text}`,
    onClose: dismiss,
  });
  if (!host || dismissed) return null;
  return createPortal(
    <div
      className={`system-settings-notice ${notice.kind}${lifecycle.fading ? " is-fading" : ""}`}
      role={notice.kind === "error" ? "alert" : "status"}
      aria-live={notice.kind === "error" ? "assertive" : "polite"}
      onMouseEnter={lifecycle.onMouseEnter}
      onMouseLeave={lifecycle.onMouseLeave}
      onFocusCapture={lifecycle.onFocus}
      onBlurCapture={lifecycle.onBlur}
    >
      <i aria-hidden="true">{notice.kind === "success" ? "✓" : "!"}</i>
      <span>{notice.text}</span>
      <button type="button" onClick={dismiss} aria-label="알림 닫기">
        ×
      </button>
    </div>,
    host,
  );
}
