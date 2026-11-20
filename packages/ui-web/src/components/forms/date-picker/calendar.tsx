"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { cx } from "../../../lib/cx";
import { IconButton } from "../../buttons/icon-button";
import { dayForKey, FULL_DATE, MONTH, WEEK, WEEKDAY } from "./calendar-grid";
import { addDays, addMonths, clamp, monthGrid, monthStart, today, toTime } from "./iso-date";

export interface CalendarProps {
  label: string;
  value: string | null;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  isDisabled?: (iso: string) => boolean;
  autoFocus?: boolean;
}

const WEEKDAY_LONG = new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: "UTC" });

/** ARIA grid pattern with one tab stop; disabled days can be reached but not chosen. */
export function Calendar({
  label,
  value,
  onChange,
  min,
  max,
  isDisabled,
  autoFocus = false,
}: CalendarProps) {
  const [focused, setFocused] = useState(() => clamp(value ?? today(), min, max));
  // Bumped when a key or click moves to a day, so focus follows it; the month buttons keep their own focus.
  const [moves, setMoves] = useState(autoFocus ? 1 : 0);
  const grid = useRef<HTMLTableElement>(null);
  useEffect(() => {
    if (moves > 0) grid.current?.querySelector<HTMLButtonElement>("[tabindex='0']")?.focus();
  }, [moves]);

  const disabled = (iso: string) =>
    (min !== undefined && iso < min) ||
    (max !== undefined && iso > max) ||
    (isDisabled?.(iso) ?? false);
  const go = (iso: string) => {
    setFocused(clamp(iso, min, max));
    setMoves((n) => n + 1);
  };
  const shown = monthStart(focused);
  const days = monthGrid(focused);
  const now = today();

  const onKeyDown = (event: KeyboardEvent) => {
    const target = dayForKey(focused, event);
    if (target) {
      event.preventDefault();
      go(target);
    } else if ((event.key === "Enter" || event.key === " ") && !disabled(focused)) {
      event.preventDefault();
      onChange(focused);
    }
  };

  const monthButton = (step: number, name: string, Icon: typeof ChevronLeft) => {
    const target = addMonths(shown, step);
    const off =
      (step < 0 && min !== undefined && addDays(shown, -1) < min) ||
      (step > 0 && max !== undefined && target > max);
    return (
      <IconButton
        label={name}
        disabled={off}
        onClick={() => setFocused(clamp(addMonths(focused, step), min, max))}
      >
        <Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
      </IconButton>
    );
  };

  return (
    <div className="flex w-[19rem] max-w-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {monthButton(-1, "Previous month", ChevronLeft)}
        <p aria-live="polite" className="text-sm font-medium text-ink">
          {MONTH.format(toTime(shown))}
        </p>
        {monthButton(1, "Next month", ChevronRight)}
      </div>
      <table
        ref={grid}
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the ARIA date picker grid pattern (APG)
        role="grid"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="w-full border-collapse"
      >
        <thead>
          <tr>
            {WEEK.map((day) => (
              <th key={day} scope="col" className="pb-1 text-center text-xs font-normal text-muted">
                <abbr title={WEEKDAY_LONG.format(toTime(day))} className="no-underline">
                  {WEEKDAY.format(toTime(day)).slice(0, 2)}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }, (_, row) => (
            <tr key={days[row * 7]}>
              {days.slice(row * 7, row * 7 + 7).map((day) => {
                const off = disabled(day);
                const chosen = day === value;
                const outside = monthStart(day) !== shown;
                return (
                  // biome-ignore lint/a11y/useFocusableInteractive: focus goes to the button inside (one tab stop per grid)
                  <td
                    key={day}
                    // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the ARIA date picker grid pattern (APG)
                    role="gridcell"
                    aria-selected={chosen}
                    className="p-0.5 text-center"
                  >
                    <button
                      type="button"
                      tabIndex={day === focused ? 0 : -1}
                      aria-label={FULL_DATE.format(toTime(day))}
                      aria-disabled={off || undefined}
                      aria-current={day === now ? "date" : undefined}
                      onClick={() => {
                        go(day);
                        if (!off) onChange(day);
                      }}
                      className={cx(
                        "grid size-9 w-full place-items-center rounded-md text-sm tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-focus",
                        chosen
                          ? "bg-primary font-medium text-on-primary"
                          : off
                            ? "cursor-not-allowed text-subtle opacity-50"
                            : cx("hover:bg-surface-2", outside ? "text-subtle" : "text-ink"),
                        day === now && !chosen && "ring-1 ring-line-strong ring-inset",
                      )}
                    >
                      {Number(day.slice(8))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
