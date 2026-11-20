"use client";

import { useCallback, useState } from "react";

/** The <dialog> around a trigger, for a portal: outside a modal dialog everything is inert. */
export function useDialogContainer(): [HTMLDialogElement | null, (el: HTMLElement | null) => void] {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const ref = useCallback((el: HTMLElement | null) => setDialog(el?.closest("dialog") ?? null), []);
  return [dialog, ref];
}
