import { useCallback, useEffect, useRef, useState, type MouseEventHandler } from "react";

export const TOAST_VISIBLE_DURATION_MS = 3_000;
export const TOAST_FADE_DURATION_MS = 320;

export function useToastAutoDismiss({
  enabled,
  resetKey,
  onClose,
}: {
  enabled: boolean;
  resetKey: string;
  onClose(): void;
}): {
  fading: boolean;
  onMouseEnter: MouseEventHandler<HTMLElement>;
  onMouseLeave: MouseEventHandler<HTMLElement>;
} {
  const [fading, setFading] = useState(false);
  const onCloseRef = useRef(onClose);
  const dismissTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const deadlineRef = useRef(0);
  const remainingRef = useRef(TOAST_VISIBLE_DURATION_MS);
  const fadingRef = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current === null) return;
    window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = null;
  }, []);

  const clearFadeTimer = useCallback(() => {
    if (fadeTimerRef.current === null) return;
    window.clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = null;
  }, []);

  const beginFade = useCallback(() => {
    clearDismissTimer();
    remainingRef.current = 0;
    fadingRef.current = true;
    setFading(true);
    fadeTimerRef.current = window.setTimeout(() => {
      fadeTimerRef.current = null;
      onCloseRef.current();
    }, TOAST_FADE_DURATION_MS);
  }, [clearDismissTimer]);

  const scheduleDismiss = useCallback(
    (delay: number) => {
      clearDismissTimer();
      const normalizedDelay = Math.max(0, delay);
      remainingRef.current = normalizedDelay;
      deadlineRef.current = Date.now() + normalizedDelay;
      dismissTimerRef.current = window.setTimeout(beginFade, normalizedDelay);
    },
    [beginFade, clearDismissTimer],
  );

  useEffect(() => {
    clearDismissTimer();
    clearFadeTimer();
    fadingRef.current = false;
    setFading(false);
    remainingRef.current = TOAST_VISIBLE_DURATION_MS;
    if (enabled) scheduleDismiss(TOAST_VISIBLE_DURATION_MS);
    return () => {
      clearDismissTimer();
      clearFadeTimer();
    };
  }, [clearDismissTimer, clearFadeTimer, enabled, resetKey, scheduleDismiss]);

  const onMouseEnter: MouseEventHandler<HTMLElement> = () => {
    if (!enabled) return;
    if (fadingRef.current) {
      clearFadeTimer();
      fadingRef.current = false;
      setFading(false);
      remainingRef.current = TOAST_VISIBLE_DURATION_MS;
      return;
    }
    if (dismissTimerRef.current !== null) {
      remainingRef.current = Math.max(0, deadlineRef.current - Date.now());
      clearDismissTimer();
    }
  };

  const onMouseLeave: MouseEventHandler<HTMLElement> = () => {
    if (!enabled) return;
    scheduleDismiss(remainingRef.current > 0 ? remainingRef.current : TOAST_VISIBLE_DURATION_MS);
  };

  return { fading, onMouseEnter, onMouseLeave };
}
