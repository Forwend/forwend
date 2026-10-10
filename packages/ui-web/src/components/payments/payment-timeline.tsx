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
}

export interface PaymentTimelineProps {
  steps: readonly TimelineStep[];
  label: string;
}

export function PaymentTimeline({ steps, label }: PaymentTimelineProps) {
  return (
    <ol
      aria-label={label}
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((step) => (
        <li
          key={step.label}
          aria-current={step.state === STEP_STATES.current ? "step" : undefined}
          className="flex flex-col gap-2"
        >
          <span
            className={cx(
              "h-1 rounded-pill transition-colors duration-[var(--fw-duration-slow)] ease-out",
              step.state === STEP_STATES.complete && "bg-ink",
              step.state === STEP_STATES.current && "bg-accent",
              step.state === STEP_STATES.upcoming && "bg-line",
            )}
          />
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
      ))}
    </ol>
  );
}
