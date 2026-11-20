"use client";

import { cx } from "@forwend/ui-web";
import { type ReactNode, useRef } from "react";
import { STEP_IN } from "@/shared/constants/motion";

const CARD =
  "flex min-w-0 flex-col transition-colors duration-[var(--fw-duration-base)] max-sm:-mx-4 max-sm:min-h-dvh sm:min-h-[41.5rem] sm:rounded-lg sm:border sm:border-line";

export interface SaleCardProps {
  bar: ReactNode;
  step: string;
  foot: ReactNode;
  paid?: boolean;
  children: ReactNode;
}

export function SaleCard({ bar, step, foot, paid = false, children }: SaleCardProps) {
  const first = useRef(step);
  return (
    <div data-phone-flow className={cx(CARD, paid ? "bg-success-soft" : "bg-surface")}>
      <div className="flex min-h-15 items-center gap-2 px-3 py-1.5 max-sm:pt-[calc(0.375rem+env(safe-area-inset-top,0px))] sm:px-4 sm:py-2">
        {bar}
      </div>
      <div
        key={step}
        className={cx("flex flex-1 flex-col", step === first.current ? undefined : STEP_IN)}
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
