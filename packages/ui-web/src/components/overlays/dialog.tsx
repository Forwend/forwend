"use client";

import { X } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { BUTTON_VARIANTS, Button } from "../buttons/button";

export interface DialogProps {
  triggerLabel: string;
  title: string;
  children: ReactNode;
  closeLabel?: string;
}

export function Dialog({ triggerLabel, title, children, closeLabel = "Close" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <Button variant={BUTTON_VARIANTS.secondary} onClick={() => ref.current?.showModal()}>
        {triggerLabel}
      </Button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click only catches the backdrop; Escape is the keyboard way out */}
      <dialog
        ref={ref}
        aria-label={title}
        onClick={(event) => {
          if (event.target === ref.current) ref.current.close(); // a click on the backdrop
        }}
        className="m-auto w-[calc(100vw-(--spacing(8)))] max-w-lg rounded-lg border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-[var(--fw-scrim)] backdrop:backdrop-blur-glass"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={() => ref.current?.close()}
            className="relative rounded-pill p-1 text-muted before:absolute before:-inset-2.5 hover:bg-surface-2 hover:text-ink"
          >
            <X aria-hidden className="size-[var(--fw-icon-md)]" />
          </button>
        </div>
        <div className="px-6 py-5 text-muted">{children}</div>
      </dialog>
    </>
  );
}
