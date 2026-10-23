"use client";

import { useEffect, useRef, useState } from "react";

export const COPY_STATUS = {
  idle: "idle",
  copied: "copied",
  failed: "failed",
} as const;

export const COPIED_LABEL_MS = 1600;

export type CopyStatus = (typeof COPY_STATUS)[keyof typeof COPY_STATUS];

// Failed stays until the next attempt, so the explanation does not vanish while the user reads it.
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
    if (next === COPY_STATUS.copied) {
      timer.current = setTimeout(() => setStatus(COPY_STATUS.idle), COPIED_LABEL_MS);
    }
  };
  return [status, copy];
}
