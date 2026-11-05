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
  children: ReactNode;
  className?: string;
}

/** The steps of a sheet or dialog: the new step slides in from its direction, and the box's height follows it, so
 * the frame grows and shrinks around each step instead of jumping. Reduced motion shows each step at once. The new
 * step takes the focus, unless a field in it took it first: the control that led there is gone. */
export function StepTransition({ step, direction, children, className }: StepTransitionProps) {
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
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
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
      <div ref={inner} tabIndex={-1} className="outline-none">
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
