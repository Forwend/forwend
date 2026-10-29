"use client";

import { Check } from "lucide-react";
import { cx } from "../../lib/cx";

export interface StepperStep {
  id: string;
  label: string;
}

export interface StepperProps {
  steps: readonly StepperStep[];
  /** The index of the step on screen. */
  current: number;
  label: string;
  /** Going back to a finished step; steps ahead open only through the form's own Continue. */
  onStepClick?: (index: number) => void;
}

/** The steps of a form: a check on finished ones (a button back to them), the current one ringed, the rest muted. */
export function Stepper({ steps, current, label, onStepClick }: StepperProps) {
  return (
    <nav aria-label={label}>
      <ol className="flex items-center gap-2">
        {steps.map((step, i) => {
          const done = i < current;
          const now = i === current;
          const marker = (
            <>
              <span
                className={cx(
                  "grid size-7 shrink-0 place-items-center rounded-pill text-xs font-medium tabular-nums",
                  done && "bg-ink text-bg",
                  now && "border-2 border-accent bg-surface text-ink",
                  !done && !now && "border border-line-strong text-subtle",
                )}
              >
                {done ? <Check aria-hidden strokeWidth={3} className="size-3.5" /> : i + 1}
              </span>
              <span
                className={cx(
                  "text-sm whitespace-nowrap max-sm:sr-only",
                  now ? "font-medium text-ink" : done ? "text-ink" : "text-subtle",
                )}
              >
                {step.label}
                {done ? <span className="sr-only">, done</span> : null}
              </span>
            </>
          );
          return (
            <li
              key={step.id}
              aria-current={now ? "step" : undefined}
              className="flex min-w-0 items-center gap-2 not-last:flex-1"
            >
              {done && onStepClick ? (
                <button
                  type="button"
                  onClick={() => onStepClick(i)}
                  className="-m-1 flex items-center gap-2 rounded-md p-1 outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus"
                >
                  {marker}
                </button>
              ) : (
                <span className="flex items-center gap-2">{marker}</span>
              )}
              {i < steps.length - 1 ? (
                <span
                  aria-hidden
                  className={cx("h-px min-w-4 flex-1", done ? "bg-ink/50" : "bg-line-strong")}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
