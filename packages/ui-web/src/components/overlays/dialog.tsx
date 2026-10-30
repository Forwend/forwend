"use client";

import { X } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { cx } from "../../lib/cx";
import { BUTTON_VARIANTS, Button, type ButtonVariant } from "../buttons/button";
import { IconButton } from "../buttons/icon-button";

/** Opacity only: a scale or translate would make the dialog the containing block of a date picker's fixed popover.
 * It closes at once, as a menu does: an exit transition needs a discrete display transition, which only Chromium has. */
const DIALOG_ENTER =
  "transition-opacity duration-[var(--fw-duration-base)] ease-out starting:open:opacity-0 backdrop:transition-opacity backdrop:duration-[var(--fw-duration-base)] backdrop:ease-out starting:open:backdrop:opacity-0";

export interface DialogProps {
  triggerLabel: string;
  title: string;
  children: ReactNode;
  closeLabel?: string;
  /** How the trigger looks: a quiet link in a footer, a button elsewhere. */
  triggerVariant?: ButtonVariant;
  triggerClassName?: string;
  /** Opens the dialog from something else than its own button, such as a menu item. */
  trigger?: (open: () => void) => ReactNode;
  /** Runs however the dialog closes: its close button, Escape, the backdrop or a form inside it. */
  onClose?: () => void;
}

export function Dialog({
  triggerLabel,
  title,
  children,
  closeLabel = "Close",
  triggerVariant = BUTTON_VARIANTS.secondary,
  triggerClassName,
  trigger,
  onClose,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = () => ref.current?.showModal();
  return (
    <>
      {trigger ? (
        trigger(open)
      ) : (
        <Button variant={triggerVariant} className={triggerClassName} onClick={open}>
          {triggerLabel}
        </Button>
      )}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click only catches the backdrop; Escape is the keyboard way out */}
      <dialog
        ref={ref}
        aria-label={title}
        onClose={onClose}
        onClick={(event) => {
          if (event.target === ref.current) ref.current.close(); // a click on the backdrop
        }}
        className={cx(
          "m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain w-[calc(100vw-(--spacing(8)))] max-w-lg rounded-lg border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-[var(--fw-scrim)]",
          DIALOG_ENTER,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <IconButton label={closeLabel} onClick={() => ref.current?.close()}>
            <X aria-hidden className="size-[var(--fw-icon-md)]" />
          </IconButton>
        </div>
        <div className="px-6 py-5 text-muted">{children}</div>
      </dialog>
    </>
  );
}
