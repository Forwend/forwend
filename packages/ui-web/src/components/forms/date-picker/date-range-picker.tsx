"use client";

import { CalendarDays, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cx } from "../../../lib/cx";
import { IconButton } from "../../buttons/icon-button";
import { FIELD_CONTROL_CLASSES } from "../field-classes";
import { addDays, addMonths, monthStart, today, toTime } from "./iso-date";
import { RangeCalendar } from "./range-calendar";
import { usePopoverPosition } from "./use-popover-position";

export interface DateRange {
  /** ISO days (YYYY-MM-DD); null leaves that end open. */
  from: string | null;
  to: string | null;
}

export interface DateRangePreset {
  label: string;
  range: (todayIso: string) => { from: string; to: string };
}

export interface DateRangePickerProps {
  label: string;
  value: DateRange;
  onChange: (range: DateRange) => void;
  presets?: readonly DateRangePreset[];
  placeholder?: string;
  /** One quiet line in the popover's foot, such as which time zone the days are in. */
  note?: string;
  hint?: string;
  error?: string;
  clearLabel?: string;
  min?: string;
  max?: string;
  className?: string;
}

/** The common periods a report or export asks for, by UTC day. */
export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  { label: "Last 7 days", range: (t) => ({ from: addDays(t, -6), to: t }) },
  { label: "Last 30 days", range: (t) => ({ from: addDays(t, -29), to: t }) },
  { label: "This month", range: (t) => ({ from: monthStart(t), to: t }) },
  {
    label: "Last month",
    range: (t) => ({ from: addMonths(monthStart(t), -1), to: addDays(monthStart(t), -1) }),
  },
  { label: "This year", range: (t) => ({ from: `${t.slice(0, 4)}-01-01`, to: t }) },
];

const DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const FULL = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

function shown({ from, to }: DateRange): string | null {
  if (from && to) {
    if (from === to) return FULL.format(toTime(from));
    // One year is said once: "Oct 1 – Oct 31, 2026".
    const start = from.slice(0, 4) === to.slice(0, 4) ? DAY : FULL;
    return `${start.format(toTime(from))} – ${FULL.format(toTime(to))}`;
  }
  if (from) return `${FULL.format(toTime(from))} –`;
  if (to) return `– ${FULL.format(toTime(to))}`;
  return null;
}

/** One field for a period: presets for the usual ones, two months for any other; the second press ends it. */
export function DateRangePicker({
  label,
  value,
  onChange,
  presets = DATE_RANGE_PRESETS,
  placeholder = "Any time",
  note,
  hint,
  error,
  clearLabel,
  min,
  max,
  className,
}: DateRangePickerProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(trigger, popover, open);
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const text = shown(value);

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
  const pick = (iso: string) => {
    // A press starts a range, or ends the one started; one before the start starts again.
    if (!value.from || value.to || iso < value.from) {
      onChange({ from: iso, to: null });
      return;
    }
    onChange({ from: value.from, to: iso });
    close();
  };

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <span id={`${id}-label`} className="text-sm font-medium text-ink">
        {label}
      </span>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: catches Escape from the trigger and the popover inside */}
      <div
        ref={root}
        className="relative"
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            // Only the calendar closes: a native dialog around it would close on Escape's default action too.
            event.preventDefault();
            event.stopPropagation(); // inside a dialog, Escape closes the calendar first
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
              "flex min-w-56 items-center justify-between gap-3 text-left",
            )}
          >
            <span id={`${id}-value`} className={cx("truncate", text ? "text-ink" : "text-subtle")}>
              {text ?? placeholder}
            </span>
            <CalendarDays aria-hidden className="size-[var(--fw-icon-md)] shrink-0 text-muted" />
          </button>
          {clearLabel && (value.from || value.to) ? (
            <IconButton label={clearLabel} onClick={() => onChange({ from: null, to: null })}>
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
            className="z-[var(--fw-z-overlay)] flex max-w-[calc(100vw-1rem)] flex-col rounded-md border border-line bg-surface text-ink shadow-lg sm:flex-row"
          >
            {presets.length ? (
              <ul className="flex flex-wrap gap-1 border-line p-2 max-sm:border-b sm:w-36 sm:flex-col sm:border-r">
                {presets.map((preset) => {
                  const range = preset.range(today());
                  const on = value.from === range.from && value.to === range.to;
                  return (
                    <li key={preset.label}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          onChange(range);
                          close();
                        }}
                        className={cx(
                          "h-9 w-full rounded-md px-3 text-left text-sm whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-focus",
                          on
                            ? "bg-surface-2 font-medium text-ink"
                            : "text-muted hover:bg-surface-2 hover:text-ink",
                        )}
                      >
                        {preset.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className="flex flex-col gap-2 p-3">
              <RangeCalendar
                label={label}
                from={value.from}
                to={value.to}
                min={min}
                max={max}
                autoFocus
                onPick={pick}
              />
              {note ? <p className="border-t border-line pt-2 text-xs text-muted">{note}</p> : null}
            </div>
          </div>
        ) : null}
      </div>
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
