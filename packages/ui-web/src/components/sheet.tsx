"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { SheetProps } from "../types/ui/display";

// A modal on the native <dialog>: focus moves in and is trapped, Escape and the backdrop close it, focus returns to
// the opener. A bottom sheet on phones, a centered panel from sm up.
export function Sheet({ open, onOpenChange, title, closeLabel = "Close", children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click only catches the backdrop; Escape is the keyboard way out
    <dialog
      ref={ref}
      aria-label={title}
      onClose={() => onOpenChange(false)}
      onClick={(event) => {
        if (event.target === ref.current) onOpenChange(false); // a click on the backdrop
      }}
      className="mx-0 mt-auto mb-0 max-h-[92dvh] w-full max-w-none rounded-t-lg border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-[color-mix(in_oklab,var(--fw-ink)_40%,transparent)] backdrop:backdrop-blur-glass motion-safe:open:animate-[fw-sheet-up_var(--fw-duration-base)_var(--fw-ease-out)] sm:m-auto sm:max-w-md sm:rounded-lg"
    >
      <div className="flex items-center justify-between gap-4 px-5 pt-4 pb-2">
        <h2 className="text-lg font-medium">{title}</h2>
        <button
          type="button"
          aria-label={closeLabel}
          onClick={() => onOpenChange(false)}
          className="grid size-11 place-items-center rounded-pill text-muted hover:bg-surface-2 hover:text-ink"
        >
          <X aria-hidden className="size-[var(--fw-icon-md)]" />
        </button>
      </div>
      <div className="max-h-[calc(92dvh-4rem)] overflow-y-auto px-5 pb-6">{children}</div>
    </dialog>
  );
}
