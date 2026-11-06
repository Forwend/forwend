"use client";

import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { cx } from "../../lib/cx";
import { Button, type ButtonProps } from "./button";

export const HOLD_MS = 1200;

export interface HoldButtonProps extends Omit<ButtonProps, "onClick"> {
  /** Runs once the press has lasted holdMs; letting go sooner does nothing. */
  onHold: () => void;
  holdMs?: number;
}

const HOLD_KEYS = [" ", "Enter"];

/** Press and hold to confirm, for an action that moves money: a tap or a stray Enter can't start it. The fill crosses
 * the button while it is held and runs back when let go. Space and Enter hold it from the keyboard. */
export function HoldButton({
  onHold,
  holdMs = HOLD_MS,
  disabled,
  loading,
  className,
  children,
  ...props
}: HoldButtonProps) {
  const [held, setHeld] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(onHold);
  latest.current = onHold;
  useEffect(() => () => clearTimeout(timer.current), []);
  const stop = () => {
    clearTimeout(timer.current);
    setHeld(false);
  };
  const start = () => {
    if (disabled || loading || held) return;
    setHeld(true);
    timer.current = setTimeout(() => {
      setHeld(false);
      latest.current();
    }, holdMs);
  };
  const key = (event: KeyboardEvent, down: boolean) => {
    if (!HOLD_KEYS.includes(event.key)) return;
    // A button clicks on Space and Enter: only the hold may act.
    event.preventDefault();
    if (!down) stop();
    else if (!event.repeat) start();
  };

  return (
    <Button
      {...props}
      disabled={disabled}
      loading={loading}
      data-held={held || undefined}
      className={cx("overflow-hidden select-none [touch-action:none]", className)}
      onPointerDown={(event) => {
        if (event.button === 0) start();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(event) => key(event, true)}
      onKeyUp={(event) => key(event, false)}
      onBlur={stop}
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* The hold's progress: the one motion that says how long is left, so reduced motion keeps it. */}
      <span
        aria-hidden
        data-motion="essential"
        className="absolute inset-0 origin-left bg-current opacity-15 transition-transform"
        style={{
          transform: `scaleX(${held ? 1 : 0})`,
          transitionDuration: held ? `${holdMs}ms` : "var(--fw-duration-fast)",
          transitionTimingFunction: held ? "linear" : "var(--fw-ease-out)",
        }}
      />
      <span className="relative inline-flex items-center gap-2">{children}</span>
    </Button>
  );
}
