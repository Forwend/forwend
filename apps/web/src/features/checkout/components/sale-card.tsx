"use client";

import { cx } from "@forwend/ui-web";
import { type ReactNode, useRef } from "react";

/** What a new step puts on screen fades in place from a slight blur: the content changes, nothing slides. */
export const FADE_IN =
  "motion-safe:animate-[fw-step-in_var(--fw-duration-base)_var(--fw-ease-out)]";

// One size from the amount to Paid, so a step never moves the page. On a phone it is the whole first screen, edge to
// edge, so Paid colors all of it.
const CARD =
  "flex min-w-0 flex-col transition-colors duration-[var(--fw-duration-base)] max-sm:-mx-4 max-sm:min-h-dvh sm:min-h-[41.5rem] sm:rounded-lg sm:border sm:border-line";

export interface SaleCardProps {
  /** The top row: the way back, the store and Recent, or Cancel sale and the sale's name. */
  bar: ReactNode;
  /** A new value fades the new step in. */
  step: string;
  /** The keys and the actions, at the bottom: within a thumb's reach on a phone. */
  foot: ReactNode;
  paid?: boolean;
  children: ReactNode;
}

/** The sale as one screen the customer can look at. On a phone the shell's header and tab bar step aside for
 * `data-phone-flow`, so nothing else on it can be tapped. */
export function SaleCard({ bar, step, foot, paid = false, children }: SaleCardProps) {
  // The first step shows at once: the card itself fades in when it replaces another.
  const first = useRef(step);
  return (
    <div data-phone-flow className={cx(CARD, paid ? "bg-success-soft" : "bg-surface")}>
      <div className="flex min-h-15 items-center gap-2 px-3 py-1.5 max-sm:pt-[calc(0.375rem+env(safe-area-inset-top,0px))] sm:px-4 sm:py-2">
        {bar}
      </div>
      <div
        key={step}
        className={cx("flex flex-1 flex-col", step === first.current ? undefined : FADE_IN)}
      >
        <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-5 pt-2 pb-4 text-center">
          {children}
        </div>
        <div className="mx-auto flex w-full max-w-[26rem] flex-col gap-2.5 px-4 pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))] sm:pb-4">
          {foot}
        </div>
      </div>
    </div>
  );
}
