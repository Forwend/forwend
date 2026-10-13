import { Clock } from "lucide-react";
import { cx } from "../../lib/cx";
import { TONE_CLASSES, type Tone } from "../../lib/tone";
import { Tooltip } from "../overlays/tooltip";

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
  /** Shows the label as a tinted badge, for a step that ended in a state worth noticing (partly paid). */
  tone?: Tone;
  /** A short note behind a clock icon after the label, such as the time a step has left; also its accessible name. */
  hint?: string;
}

export interface PaymentTimelineProps {
  steps: readonly TimelineStep[];
  label: string;
  /** Read after a complete step's label. */
  doneLabel?: string;
  /** Read after an upcoming step's label. */
  notStartedLabel?: string;
}

// Each bar is a track with a fill that grows from the left, so a step filling or completing slides rather than jumps.
function fill(step: TimelineStep): number {
  if (step.state === STEP_STATES.complete) return 1;
  if (step.state === STEP_STATES.upcoming) return 0;
  return typeof step.progress === "number" ? Math.min(1, Math.max(0, step.progress)) : 1;
}

export function PaymentTimeline({
  steps,
  label,
  doneLabel = ", done",
  notStartedLabel = ", not started",
}: PaymentTimelineProps) {
  return (
    <ol
      aria-label={label}
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((step, i) => {
        const sweeping = step.state === STEP_STATES.current && step.progress === null;
        return (
          <li
            // A label can change while its step runs (a count); the place keeps the bar mounted, so it slides.
            // biome-ignore lint/suspicious/noArrayIndexKey: the steps are a fixed list in a fixed order
            key={i}
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
            <span className="flex flex-wrap items-center gap-1">
              <span
                className={cx(
                  "text-xs",
                  step.tone
                    ? cx(
                        "self-start rounded-pill border px-2 py-0.5 font-medium",
                        TONE_CLASSES[step.tone],
                      )
                    : step.state === STEP_STATES.upcoming
                      ? "text-subtle"
                      : "font-medium text-ink",
                )}
              >
                {step.label}
                {step.state === STEP_STATES.current ? null : (
                  <span className="sr-only">
                    {step.state === STEP_STATES.complete ? doneLabel : notStartedLabel}
                  </span>
                )}
              </span>
              {step.hint ? (
                <Tooltip content={step.hint}>
                  <button
                    type="button"
                    aria-label={step.hint}
                    className="grid size-5 place-items-center rounded-pill text-muted outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <Clock aria-hidden className="size-3.5" />
                  </button>
                </Tooltip>
              ) : null}
            </span>
            {step.detail ? (
              <span className="font-mono text-xs text-subtle [overflow-wrap:anywhere]">
                {step.detail}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
