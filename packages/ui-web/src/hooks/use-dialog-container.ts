"use client";

import { useCallback, useState } from "react";

/** The <dialog> around a popup's trigger, for the popup's portal: inside a modal dialog everything outside it is
 * inert and hidden behind it. Pass the ref callback to the trigger. */
export function useDialogContainer(): [HTMLDialogElement | null, (el: HTMLElement | null) => void] {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const ref = useCallback((el: HTMLElement | null) => setDialog(el?.closest("dialog") ?? null), []);
  return [dialog, ref];
}
