import { cx } from "@forwend/ui-web";
import { Check, Lock } from "lucide-react";
import { RECORD_STEPS } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import type { RecordStep } from "@/features/invoices/types/invoices";
import { shortDate } from "@/shared/lib/dates";

const STATES = {
  done: "done",
  current: "current",
  upcoming: "upcoming",
  stopped: "stopped",
} as const;
type StepState = (typeof STATES)[keyof typeof STATES];

export interface InvoiceStepsProps {
  steps: readonly RecordStep[];
  className?: string;
}

/** The invoice's record as one row across the amount panel: done is a check, now an accent ring, how it ended a
 * lock. Phones show the same steps as a vertical timeline. */
export function InvoiceSteps({ steps, className }: InvoiceStepsProps) {
  const ended = steps.some((s) => s.id === RECORD_STEPS.closed || s.id === RECORD_STEPS.canceled);
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol aria-label={COPY.progressTitle} className={cx("flex gap-4", className)}>
      {steps.map((step, i) => {
        const state: StepState =
          ended && i === steps.length - 1
            ? STATES.stopped
            : step.done
              ? STATES.done
              : i === current && !ended
                ? STATES.current
                : STATES.upcoming;
        const note = step.count ? COPY.opened(step.count) : step.at ? shortDate(step.at) : null;
        const last = i === steps.length - 1;
        return (
          <li
            key={step.id}
            aria-current={state === STATES.current ? "step" : undefined}
            // The last step takes its own width, so the row ends at the panel's edge.
            className={cx("flex min-w-0 flex-col gap-2", last ? "shrink-0" : "flex-1")}
          >
            <span className="flex items-center gap-2">
              <Marker state={state} />
              {last ? null : (
                <span
                  aria-hidden
                  className={cx(
                    "-mr-4 h-px flex-1",
                    state === STATES.done ? "bg-ink/40" : "bg-line-strong",
                  )}
                />
              )}
            </span>
            <span className="min-w-0">
              <span
                className={cx(
                  "block text-sm",
                  state === STATES.upcoming ? "text-subtle" : "font-medium text-ink",
                )}
              >
                {COPY.timelineSteps[step.id]}
              </span>
              {note ? <span className="block text-xs text-muted tabular-nums">{note}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Marker({ state }: { state: StepState }) {
  const said = <span className="sr-only">{COPY.stepStates[state]}: </span>;
  if (state === STATES.done) {
    return (
      // A step that finishes while the page is open fades in where its ring was.
      <span className="grid size-5 shrink-0 place-items-center rounded-pill bg-ink text-bg transition-[opacity,scale] duration-[var(--fw-duration-base)] ease-[var(--fw-ease-out)] starting:scale-75 starting:opacity-0">
        <Check aria-hidden strokeWidth={3} className="size-3" />
        {said}
      </span>
    );
  }
  if (state === STATES.stopped) {
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded-pill bg-surface-2 text-muted ring-1 ring-line-strong">
        <Lock aria-hidden className="size-3" />
        {said}
      </span>
    );
  }
  if (state === STATES.current) {
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded-pill border-2 border-accent bg-surface">
        <span className="size-1.5 rounded-pill bg-accent" />
        {said}
      </span>
    );
  }
  return (
    <span className="size-5 shrink-0 rounded-pill border border-line-strong bg-surface">
      {said}
    </span>
  );
}
