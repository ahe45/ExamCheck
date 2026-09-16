import { useLayoutEffect, useRef, useState } from "react";
import type { Examinee } from "../../shared/api/examinees";
import type { PseudonymAssignment } from "../../shared/api/pseudonyms";

export interface OperationLookupSelection {
  candidate: Examinee;
  assignment: PseudonymAssignment | null;
}

interface Options {
  ready: boolean;
  printing: boolean;
  labelPrintingEnabled: boolean;
  lookup(input: string): Promise<OperationLookupSelection | undefined>;
  isCurrent(selection: OperationLookupSelection): boolean;
  print(selection: OperationLookupSelection): Promise<void>;
}

// Only an explicit input submission triggers printing; roster selection remains a lookup.
export function useOperationLookupAndPrint(options: Options) {
  const latest = useRef(options);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    latest.current = options;
  });

  async function submit(input: string) {
    if (!input.trim() || !latest.current.ready || latest.current.printing || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const result = await latest.current.lookup(input);
      if (result?.assignment && latest.current.labelPrintingEnabled && latest.current.isCurrent(result)) {
        // Use the returned candidate, not the previous render's selected candidate.
        await latest.current.print(result);
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { busy, submit };
}
