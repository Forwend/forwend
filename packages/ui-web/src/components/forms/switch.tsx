"use client";

import { cx } from "../../lib/cx";

export interface SwitchProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Switch({ label, checked, onCheckedChange, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className="group inline-flex items-center gap-3 text-sm disabled:cursor-not-allowed disabled:text-subtle"
    >
      <span
        className={cx(
          "relative inline-flex h-6 w-11 shrink-0 rounded-pill border transition-colors duration-[var(--fw-duration-base)] ease-out",
          checked ? "border-transparent bg-accent" : "border-line-strong bg-surface-2",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 size-4.5 rounded-pill bg-surface shadow-sm transition-transform duration-[var(--fw-duration-base)] ease-out",
            checked ? "translate-x-5.5" : "translate-x-0.5",
          )}
        />
      </span>
      {label}
    </button>
  );
}
