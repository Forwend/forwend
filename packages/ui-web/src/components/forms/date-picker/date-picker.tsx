"use client";

import { CalendarDays, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cx } from "../../../lib/cx";
import { IconButton } from "../../buttons/icon-button";
import { FIELD_CONTROL_CLASSES } from "../field-classes";
import { Calendar, type CalendarProps } from "./calendar";
import { toTime } from "./iso-date";
import { usePopoverPosition } from "./use-popover-position";

export interface DatePickerProps extends Pick<CalendarProps, "min" | "max" | "isDisabled"> {
  label: string;
  /** The chosen ISO date (YYYY-MM-DD), or null for none. */
  value: string | null;
  onChange: (iso: string | null) => void;
  /** Sent with the form as an ISO date, empty when none is chosen. */
  name?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  /** Shows a button that clears the date; for optional fields. */
  clearLabel?: string;
  className?: string;
}

const SHOWN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

export function DatePicker({
  label,
  value,
  onChange,
  name,
  placeholder = "Choose a date",
  hint,
  error,
  clearLabel,
  min,
  max,
  isDisabled,
  className,
}: DatePickerProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(trigger, popover, open);
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <span id={`${id}-label`} className="text-sm font-medium text-ink">
        {label}
      </span>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: catches Escape from the trigger and the calendar inside */}
      <div
        ref={root}
        className="relative"
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            // Only the calendar closes: a native dialog around it would close on Escape's default action too.
            event.preventDefault();
            event.stopPropagation(); // inside a sheet, Escape closes the calendar first
            close();
          }
        }}
      >
        <div className="flex items-center gap-2">
          <button
            ref={trigger}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-labelledby={`${id}-label ${id}-value`}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onClick={() => setOpen((o) => !o)}
            className={cx(
              FIELD_CONTROL_CLASSES,
              "flex items-center justify-between gap-3 text-left",
            )}
          >
            <span id={`${id}-value`} className={value ? "text-ink" : "text-subtle"}>
              {value ? SHOWN.format(toTime(value)) : placeholder}
            </span>
            <CalendarDays aria-hidden className="size-[var(--fw-icon-md)] shrink-0 text-muted" />
          </button>
          {clearLabel && value ? (
            <IconButton label={clearLabel} onClick={() => onChange(null)}>
              <X aria-hidden className="size-[var(--fw-icon-sm)]" />
            </IconButton>
          ) : null}
        </div>
        {open ? (
          <div
            ref={popover}
            role="dialog"
            aria-labelledby={`${id}-label`}
            style={position}
            className="z-[var(--fw-z-overlay)] max-w-[calc(100vw-1rem)] rounded-md border border-line bg-surface p-3 text-ink shadow-lg"
          >
            <Calendar
              label={label}
              value={value}
              min={min}
              max={max}
              isDisabled={isDisabled}
              autoFocus
              onChange={(iso) => {
                onChange(iso);
                close();
              }}
            />
          </div>
        ) : null}
      </div>
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
