"use client";

import { useEffect, useRef, useState } from "react";
import { COPIED_LABEL_MS } from "../constants/timing";

export function useCopy(text: string): [boolean, () => Promise<void>] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard blocked (permissions, insecure context): keep the "Copy" label, nothing copied.
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_LABEL_MS);
  };
  return [copied, copy];
}
