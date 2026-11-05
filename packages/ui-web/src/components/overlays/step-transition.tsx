"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx } from "../../lib/cx";

export const STEP_DIRECTIONS = { next: "next", back: "back" } as const;
export type StepDirection = (typeof STEP_DIRECTIONS)[keyof typeof STEP_DIRECTIONS];

export interface StepTransitionProps {
  /** Changing it starts the new step's entrance. */
  step: string;
  /** next enters from the right, back from the left, so the way through the steps has a place. */
  direction: StepDirection;
  /** The step's name, read out when the step takes the focus. */
  label: string;
  children: ReactNode;
  className?: string;
}

/** The steps of a sheet or dialog: the new step slides in from its direction, and the box's height follows it, so
 * the frame grows and shrinks around each step instead of jumping. Reduced motion shows each step at once. When the
 * control that led to the step is gone, the step takes the focus and is read out by its name; a field that took the
 * focus, or a Back button that is still there, keeps it. */
export function StepTransition({
  step,
  direction,
  label,
  children,
  className,
}: StepTransitionProps) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    const el = inner.current;
    const active = document.activeElement;
    if (el && (!active || active === document.body || !active.isConnected))
      el.focus({ preventScroll: true });
  }, [step]);
  return (
    // The 4px band keeps focus rings and the step's offset inside the clip.
    <div
      style={height === null ? undefined : { height: height + 8 }}
      className={cx(
        "-m-1 overflow-hidden p-1 transition-[height] duration-[var(--fw-duration-base)] ease-out motion-reduce:transition-none",
        className,
      )}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a step holds lists and text, not only a form's fields, so a fieldset doesn't fit */}
      <div ref={inner} role="group" aria-label={label} tabIndex={-1} className="outline-none">
        <div
          key={step}
          className={cx(
            "motion-safe:animate-[fw-step-in_var(--fw-duration-base)_var(--fw-ease-out)]",
            direction === STEP_DIRECTIONS.back ? "[--fw-step-x:-12px]" : "[--fw-step-x:12px]",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
