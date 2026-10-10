import { cx } from "../../lib/cx";

export const STEP_STATES = {
  complete: "complete",
  current: "current",
  upcoming: "upcoming",
} as const;

export type StepState = (typeof STEP_STATES)[keyof typeof STEP_STATES];

export interface TimelineStep {
  label: string;
  state: StepState;
  detail?: string;
  /**
   * The current step's share done, 0 to 1: its bar fills that far. Null while it runs with no known share: a sweep
   * moves along the bar. Left out, the current step's bar is full.
   */
  progress?: number | null;
}

export interface PaymentTimelineProps {
  steps: readonly TimelineStep[];
  label: string;
}

// Each bar is a track with a fill that grows from the left, so a step filling or completing slides rather than jumps.
function fill(step: TimelineStep): number {
  if (step.state === STEP_STATES.complete) return 1;
  if (step.state === STEP_STATES.upcoming) return 0;
  return typeof step.progress === "number" ? Math.min(1, Math.max(0, step.progress)) : 1;
}

export function PaymentTimeline({ steps, label }: PaymentTimelineProps) {
  return (
    <ol
      aria-label={label}
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((step) => {
        const sweeping = step.state === STEP_STATES.current && step.progress === null;
        return (
          <li
            key={step.label}
            aria-current={step.state === STEP_STATES.current ? "step" : undefined}
            className="flex flex-col gap-2"
          >
            <span
              className={cx(
                "relative h-1 overflow-hidden rounded-pill",
                sweeping
                  ? "bg-[color-mix(in_oklab,var(--fw-accent)_30%,var(--fw-line))]"
                  : "bg-line",
              )}
            >
              {sweeping ? (
                <span className="absolute inset-y-0 left-0 w-2/5 rounded-pill bg-accent animate-[fw-progress_calc(var(--fw-duration-slower)*1.6)_var(--fw-ease-in-out)_infinite] motion-reduce:hidden" />
              ) : (
                <span
                  className={cx(
                    "absolute inset-0 origin-left rounded-pill transition-[transform,background-color] duration-[var(--fw-duration-slow)] ease-out",
                    step.state === STEP_STATES.complete ? "bg-ink" : "bg-accent",
                  )}
                  style={{ transform: `scaleX(${fill(step)})` }}
                />
              )}
            </span>
            <span
              className={cx(
                "text-xs",
                step.state === STEP_STATES.upcoming ? "text-subtle" : "font-medium text-ink",
              )}
            >
              {step.label}
            </span>
            {step.detail ? (
              <span className="font-mono text-xs text-subtle">{step.detail}</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
