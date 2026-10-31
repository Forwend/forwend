"use client";

import { cx } from "../../lib/cx";

export interface SwitchProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/** A setting that takes effect when flipped. On, the thumb is the lightest thing on it in both themes. */
export function Switch({ label, checked, onCheckedChange, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cx(
        "group inline-flex min-h-11 items-center gap-3 text-left text-sm disabled:cursor-not-allowed disabled:text-subtle",
        className,
      )}
    >
      <SwitchTrack checked={checked} />
      {label}
    </button>
  );
}

/** The track and thumb, for a switch whose label sits elsewhere (SwitchCard). */
export function SwitchTrack({ checked }: { checked: boolean }) {
  return (
    <span
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 rounded-pill border transition-colors duration-[var(--fw-duration-base)] ease-out",
        checked ? "border-transparent bg-accent" : "border-line-strong bg-surface-2",
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 size-4.5 rounded-pill shadow-sm transition-[translate,background-color] duration-[var(--fw-duration-base)] ease-out",
          checked ? "translate-x-5.5 bg-surface dark:bg-ink" : "translate-x-0.5 bg-subtle",
        )}
      />
    </span>
  );
}
