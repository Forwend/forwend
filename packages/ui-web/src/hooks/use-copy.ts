"use client";

import { useEffect, useRef, useState } from "react";

/** What the last copy did: nothing yet, copied, or the clipboard refused. */
export const COPY_STATUS = {
  idle: "idle",
  copied: "copied",
  failed: "failed",
} as const;

/** How long "Copied" stays before the label returns to "Copy", in ms. */
export const COPIED_LABEL_MS = 1600;

export type CopyStatus = (typeof COPY_STATUS)[keyof typeof COPY_STATUS];

// Copies text; the status says copied or failed (clipboard blocked by permissions or an insecure context) for a
// moment, then returns to idle, so callers can confirm or explain (DESIGN.md: copy controls).
export function useCopy(text: string): [CopyStatus, () => Promise<void>] {
  const [status, setStatus] = useState<CopyStatus>(COPY_STATUS.idle);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    let next: CopyStatus = COPY_STATUS.copied;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      next = COPY_STATUS.failed;
    }
    setStatus(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(COPY_STATUS.idle), COPIED_LABEL_MS);
  };
  return [status, copy];
}
