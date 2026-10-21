import { useCallback, useEffect, useRef, useState } from "react";

// Render from the operator's React tree so both windows always share the same state.
export function useCandidateDisplayWindow(onBlocked: () => void) {
  const popupRef = useRef<Window | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const open = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
      return;
    }
    const popup = window.open("", "_blank", "popup=yes,width=1280,height=900,resizable=yes,scrollbars=yes");
    if (!popup) {
      onBlocked();
      return;
    }
    popupRef.current = popup;
    popup.document.title = "수험생 안내 화면 · 가번호 관리 시스템";
    const base = popup.document.createElement("base");
    base.href = document.baseURI;
    popup.document.head.append(base);
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((style) => {
      popup.document.head.append(style.cloneNode(true));
    });
    popup.document.documentElement.lang = "ko";
    const root = popup.document.createElement("div");
    popup.document.body.replaceChildren(root);
    setContainer(root);
  }, [onBlocked]);

  useEffect(() => {
    if (!container) return;
    const timer = window.setInterval(() => {
      if (popupRef.current?.closed) {
        popupRef.current = null;
        setContainer(null);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [container]);

  useEffect(() => {
    const close = () => {
      popupRef.current?.close();
      popupRef.current = null;
    };
    window.addEventListener("pagehide", close);
    return () => {
      window.removeEventListener("pagehide", close);
      close();
    };
  }, []);

  return { container, open };
}
