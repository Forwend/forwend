import { Check, Clock } from "lucide-react";
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
  /** The current step's share done, 0 to 1, drawn as its ring's fill; null or left out, the ring turns (no share is
   * known, so nothing pretends to approach the end). */
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

/** Done, now and next differ by shape as well as color: a filled disc with a check, a ring, and an empty circle. */
function Marker({ step }: { step: TimelineStep }) {
  if (step.state === STEP_STATES.complete) {
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded-pill bg-ink text-bg">
        <Check aria-hidden strokeWidth={3} className="size-3" />
      </span>
    );
  }
  if (step.state === STEP_STATES.upcoming) {
    return <span className="size-5 shrink-0 rounded-pill border border-line-strong bg-surface" />;
  }
  return <StepRing progress={step.progress} />;
}

/** A step in progress: its share done as the ring's fill, or a turning ring while no share is known. */
export function StepRing({ progress }: { progress?: number | null }) {
  const share = typeof progress === "number" ? Math.min(1, Math.max(0, progress)) : null;
  return (
    <span className="relative grid size-5 shrink-0 place-items-center rounded-pill bg-surface">
      {share === null ? (
        // Turning says "working on it", not "almost there"; reduced motion keeps a still quarter.
        <span className="absolute inset-0 rounded-pill border-2 border-line border-t-accent animate-[fw-spin_var(--fw-duration-slower)_linear_infinite] motion-reduce:animate-none" />
      ) : (
        <span
          className="absolute inset-0 rounded-pill [background:conic-gradient(var(--fw-accent)_calc(var(--fw-share)*1turn),var(--fw-line)_0)] [mask:radial-gradient(circle,transparent_calc(50%-2px),#000_calc(50%-2px))]"
          style={{ "--fw-share": share } as CSSProperties}
        />
      )}
      <span className="size-1.5 rounded-pill bg-accent" />
    </span>
  );
}

export function PaymentTimeline({
  steps,
  label,
  doneLabel = ", done",
  notStartedLabel = ", not started",
}: PaymentTimelineProps) {
  // Side by side, the path runs edge to edge with the steps evenly apart: the first at the start, the last at the end,
  // each between centered on two half columns. Five steps can't share a phone's width, so narrower than 28rem they
  // stack into one vertical path; up to four always sit side by side.
  const stack = steps.length > 4;
  const lastIndex = steps.length - 1;
  const line = (state: StepState) => (state === STEP_STATES.complete ? "bg-ink" : "bg-line-strong");
  return (
    <div className="@container">
      <ol
        aria-label={label}
        className={cx(
          "grid grid-cols-[repeat(var(--fw-cols),minmax(0,1fr))]",
          stack && "@max-md:grid-cols-1",
        )}
        style={{ "--fw-cols": Math.max(1, 2 * lastIndex) } as CSSProperties}
      >
        {steps.map((step, i) => {
          const first = i === 0;
          const last = i === lastIndex && !first;
          // Where the label sits under its marker; a first or last label may run into the next half column.
          const align = cx(
            "w-max",
            first
              ? "max-w-[200%] justify-self-start"
              : last
                ? "max-w-[200%] justify-self-end justify-end text-right"
                : "max-w-full justify-self-center justify-center text-center",
            stack &&
              "@max-md:col-span-1 @max-md:col-start-2 @max-md:max-w-full @max-md:justify-self-start @max-md:justify-start @max-md:text-left",
          );
          return (
            <li
              // A label can change while its step runs (a count); the place keeps the marker mounted.
              // biome-ignore lint/suspicious/noArrayIndexKey: the steps are a fixed list in a fixed order
              key={i}
              aria-current={step.state === STEP_STATES.current ? "step" : undefined}
              className={cx(
                "grid grid-rows-[1.25rem_auto] gap-y-1.5",
                first
                  ? "grid-cols-[1.25rem_minmax(0,1fr)]"
                  : last
                    ? "grid-cols-[minmax(0,1fr)_1.25rem]"
                    : "col-span-2 grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)]",
                stack &&
                  "@max-md:col-span-1 @max-md:grid-cols-[1.25rem_minmax(0,1fr)] @max-md:gap-x-3",
              )}
            >
              {/* The path to and from the marker: ink once the step before is done, so it shows how far it got. */}
              {first ? null : (
                <span
                  aria-hidden
                  className={cx(
                    "mr-2 h-px self-center",
                    line(steps[i - 1]?.state ?? step.state),
                    stack && "@max-md:hidden",
                  )}
                />
              )}
              <Marker step={step} />
              {i === lastIndex ? null : (
                <span
                  aria-hidden
                  className={cx(
                    "ml-2 h-px self-center",
                    line(step.state),
                    stack && "@max-md:hidden",
                  )}
                />
              )}
              <span
                className={cx(
                  "col-span-full flex flex-wrap items-center gap-1",
                  align,
                  stack && "@max-md:row-start-1",
                )}
              >
                <span
                  className={cx(
                    "text-xs",
                    stack && "@max-md:text-sm",
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
                    <IconButton label={step.hint} size="xs">
                      <Clock aria-hidden className="size-3.5" />
                    </IconButton>
                  </Tooltip>
                ) : null}
              </span>
              {step.detail ? (
                <span
                  className={cx(
                    "col-span-full text-xs text-muted tabular-nums [overflow-wrap:anywhere]",
                    align,
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
