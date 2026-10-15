"use client";

import { X } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { BUTTON_VARIANTS, Button, type ButtonVariant } from "../buttons/button";
import { IconButton } from "../buttons/icon-button";

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
}

export function Dialog({
  triggerLabel,
  title,
  children,
  closeLabel = "Close",
  triggerVariant = BUTTON_VARIANTS.secondary,
  triggerClassName,
  trigger,
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
        onClick={(event) => {
          if (event.target === ref.current) ref.current.close(); // a click on the backdrop
        }}
        className="m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain w-[calc(100vw-(--spacing(8)))] max-w-lg rounded-lg border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-[var(--fw-scrim)]"
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
