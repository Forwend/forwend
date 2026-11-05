"use client";

import { ArrowLeft, X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { cx } from "../../lib/cx";
import { IconButton } from "../buttons/icon-button";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel?: string;
  /** A step after the first: a Back button sits before the title. */
  onBack?: () => void;
  backLabel?: string;
  /** Work that closing would not stop is running, such as a signature: Escape, the backdrop and Close do nothing. */
  locked?: boolean;
  children: ReactNode;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  closeLabel = "Close",
  onBack,
  backLabel = "Back",
  locked = false,
  children,
}: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Opening focuses the close button, which then shows a focus ring before anyone used the keyboard.
      dialog.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click only catches the backdrop; Escape is the keyboard way out
    <dialog
      ref={ref}
      aria-label={title}
      tabIndex={-1}
      onCancel={(event) => {
        if (locked) event.preventDefault(); // Escape
      }}
      onClose={() => {
        // A second Escape can't be prevented: a locked sheet opens again at once.
        if (locked) ref.current?.showModal();
        else onOpenChange(false);
      }}
      onClick={(event) => {
        if (event.target === ref.current && !locked) onOpenChange(false); // a click on the backdrop
      }}
      className={cx(
        "mx-0 mt-auto mb-0 max-h-[92dvh] outline-none w-full max-w-none rounded-t-lg border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-[var(--fw-scrim)] sm:m-auto sm:max-w-md sm:rounded-lg",
        // Phones only: the bottom sheet slides up. Closing stays instant: an exit transition needs a discrete
        // display/overlay transition, which only Chromium supports, so other browsers flash the closing sheet.
        "max-sm:transition-[translate] max-sm:duration-[var(--fw-duration-base)] max-sm:ease-out max-sm:starting:open:translate-y-full",
        "max-sm:backdrop:transition-opacity max-sm:backdrop:duration-[var(--fw-duration-base)] max-sm:backdrop:ease-out max-sm:starting:open:backdrop:opacity-0",
        // From small screens up it is a centered panel, which enters as a dialog does.
        "sm:transition-opacity sm:duration-[var(--fw-duration-base)] sm:ease-out sm:starting:open:opacity-0 sm:backdrop:transition-opacity sm:backdrop:duration-[var(--fw-duration-base)] sm:backdrop:ease-out sm:starting:open:backdrop:opacity-0",
      )}
    >
      <div className="flex items-center justify-between gap-4 px-5 pt-4 pb-2">
        <div className="flex min-w-0 items-center gap-1">
          {onBack ? (
            <IconButton label={backLabel} size="md" onClick={onBack} className="-ml-2">
              <ArrowLeft aria-hidden className="size-[var(--fw-icon-md)]" />
            </IconButton>
          ) : null}
          <h2 className="truncate text-lg font-medium">{title}</h2>
        </div>
        <IconButton
          label={closeLabel}
          size="md"
          disabled={locked}
          onClick={() => onOpenChange(false)}
        >
          <X aria-hidden className="size-[var(--fw-icon-md)]" />
        </IconButton>
      </div>
      <div className="max-h-[calc(92dvh-4rem)] overflow-y-auto overscroll-contain px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        {children}
      </div>
    </dialog>
  );
}
