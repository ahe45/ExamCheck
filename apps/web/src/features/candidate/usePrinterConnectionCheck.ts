import { useEffect } from "react";

export function usePrinterConnectionCheck(enabled: boolean, scopeKey: string, diagnose: () => Promise<void>) {
  useEffect(() => {
    if (!enabled) return;
    void diagnose();
  }, [diagnose, enabled, scopeKey]);
}
