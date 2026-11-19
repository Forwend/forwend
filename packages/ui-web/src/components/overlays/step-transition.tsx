"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx } from "../../lib/cx";

export interface StepTransitionProps {
  step: string;
  label: string;
  children: ReactNode;
  className?: string;
}

/** A sheet's steps: each fades in place, the height follows, and focus moves in if its trigger is gone. */
export function StepTransition({ step, label, children, className }: StepTransitionProps) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Only a step after the first enters: opening the sheet is its own fade.
  const first = useRef(step);
  const moved = useRef(false);
  if (step !== first.current) moved.current = true;
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
          className={
            moved.current
              ? "motion-safe:animate-[fw-step-in_var(--fw-duration-base)_var(--fw-ease-out)]"
              : undefined
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}
