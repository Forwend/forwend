import { Clock } from "lucide-react";
import type { CSSProperties } from "react";
import { cx } from "../../lib/cx";
import { TONE_CLASSES, type Tone } from "../../lib/tone";
import { IconButton } from "../buttons/icon-button";
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
  // Side by side while each step has room. Five steps can't share a phone's width, so narrower than 28rem they stack
  // into one vertical path, the same bars standing upright beside their labels; up to four always sit side by side.
  const stack = steps.length > 4;
  return (
    <div className="@container">
      <ol
        aria-label={label}
        className={cx(
          "grid grid-cols-[repeat(var(--fw-steps),minmax(min-content,1fr))] gap-2",
          stack && "@max-md:grid-cols-1 @max-md:gap-1",
        )}
        style={{ "--fw-steps": steps.length } as CSSProperties}
      >
        {steps.map((step, i) => {
          const sweeping = step.state === STEP_STATES.current && step.progress === null;
          return (
            <li
              // A label can change while its step runs (a count); the place keeps the bar mounted, so it slides.
              // biome-ignore lint/suspicious/noArrayIndexKey: the steps are a fixed list in a fixed order
              key={i}
              aria-current={step.state === STEP_STATES.current ? "step" : undefined}
              className={cx(
                "flex flex-col gap-2",
                stack &&
                  "@max-md:grid @max-md:grid-cols-[0.25rem_minmax(0,1fr)] @max-md:gap-x-3 @max-md:gap-y-0",
              )}
            >
              <span
                className={cx(
                  "relative h-1 overflow-hidden rounded-pill",
                  stack && "@max-md:row-span-2 @max-md:h-auto @max-md:w-1",
                  sweeping
                    ? "bg-[color-mix(in_oklab,var(--fw-accent)_30%,var(--fw-line))]"
                    : "bg-line",
                )}
              >
                {sweeping ? (
                  <span
                    className={cx(
                      "absolute inset-y-0 left-0 w-2/5 rounded-pill bg-accent animate-[fw-progress_calc(var(--fw-duration-slower)*1.6)_var(--fw-ease-in-out)_infinite] motion-reduce:hidden",
                      stack &&
                        "@max-md:inset-x-0 @max-md:top-0 @max-md:bottom-auto @max-md:h-2/5 @max-md:w-auto @max-md:animate-[fw-progress-down_calc(var(--fw-duration-slower)*1.6)_var(--fw-ease-in-out)_infinite]",
                    )}
                  />
                ) : (
                  <span
                    className={cx(
                      "absolute inset-0 origin-left rounded-pill [transform:scaleX(var(--fw-fill))] transition-[transform,background-color] duration-[var(--fw-duration-slow)] ease-out",
                      stack && "@max-md:origin-top @max-md:[transform:scaleY(var(--fw-fill))]",
                      step.state === STEP_STATES.complete ? "bg-ink" : "bg-accent",
                    )}
                    style={{ "--fw-fill": fill(step) } as CSSProperties}
                  />
                )}
              </span>
              <span className={cx("flex flex-wrap items-center gap-1", stack && "@max-md:min-h-8")}>
                <span
                  className={cx(
                    "text-xs",
                    stack && "@max-md:text-sm",
                    step.tone
                      ? cx(
                          "self-start rounded-pill border px-2 py-0.5 font-medium",
                          stack && "@max-md:self-center",
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
                    <IconButton label={step.hint} size="xs">
                      <Clock aria-hidden className="size-3.5" />
                    </IconButton>
                  </Tooltip>
                ) : null}
              </span>
              {step.detail ? (
                <span
                  className={cx(
                    "font-mono text-xs text-subtle [overflow-wrap:anywhere]",
                    stack && "@max-md:pb-2",
                  )}
                >
                  {step.detail}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
