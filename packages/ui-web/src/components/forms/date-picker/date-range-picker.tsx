"use client";

import { CalendarDays, X } from "lucide-react";
import { useId } from "react";
import { cx } from "../../../lib/cx";
import { IconButton } from "../../buttons/icon-button";
import { FIELD_CONTROL_CLASSES } from "../field-classes";
import { FieldMessage, fieldMessageId } from "../field-message";
import { addDays, addMonths, monthStart, today, toTime } from "./iso-date";
import { RangeCalendar } from "./range-calendar";
import { useDatePopover } from "./use-date-popover";

export interface DateRange {
  from: string | null; // ISO day; null leaves that end open
  to: string | null;
}

export interface DateRangePickerProps {
  label: string;
  value: DateRange;
  onChange: (range: DateRange) => void;
  note?: string;
  error?: string;
  clearLabel?: string;
}

/** The common periods a report or export asks for, by UTC day. */
const PRESETS: readonly {
  label: string;
  range: (today: string) => { from: string; to: string };
}[] = [
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

/** One field for a period: a preset, or two months where the second press ends the range. */
export function DateRangePicker({
  label,
  value,
  onChange,
  note,
  error,
  clearLabel,
}: DateRangePickerProps) {
  const id = useId();
  const { open, toggle, close, onKeyDown, root, trigger, popover, position } = useDatePopover();
  const text = shown(value);

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
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-sm font-medium text-ink">
        {label}
      </span>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: catches Escape from the trigger and the popover inside */}
      <div ref={root} className="relative" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-2">
          <button
            ref={trigger}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-labelledby={`${id}-label ${id}-value`}
            aria-invalid={error ? true : undefined}
            aria-describedby={fieldMessageId(id, error)}
            onClick={toggle}
            className={cx(
              FIELD_CONTROL_CLASSES,
              "flex min-w-56 items-center justify-between gap-3 text-left",
            )}
          >
            <span id={`${id}-value`} className={cx("truncate", text ? "text-ink" : "text-subtle")}>
              {text ?? "Any time"}
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
            <ul className="flex flex-wrap gap-1 border-line p-2 max-sm:border-b sm:w-36 sm:flex-col sm:border-r">
              {PRESETS.map((preset) => {
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
            <div className="flex flex-col gap-2 p-3">
              <RangeCalendar
                label={label}
                from={value.from}
                to={value.to}
                autoFocus
                onPick={pick}
              />
              {note ? <p className="border-t border-line pt-2 text-xs text-muted">{note}</p> : null}
            </div>
          </div>
        ) : null}
      </div>
      <FieldMessage fieldId={id} error={error} />
    </div>
  );
}
