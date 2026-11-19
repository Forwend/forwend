"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { cx } from "../../../lib/cx";
import { IconButton } from "../../buttons/icon-button";
import { dayForKey, FULL_DATE, MONTH, WEEK, WEEKDAY } from "./calendar-grid";
import { addMonths, monthGrid, monthStart, today, toTime } from "./iso-date";

interface RangeCalendarProps {
  label: string;
  from: string | null;
  to: string | null;
  /** The day pressed: the parent decides whether it starts or ends the range. */
  onPick: (iso: string) => void;
  autoFocus?: boolean;
}

/** Two months side by side (one on phones), one tab stop, arrow keys across both, the range shaded between its ends. */
export function RangeCalendar({ label, from, to, onPick, autoFocus = false }: RangeCalendarProps) {
  // The right month ends at the range's end (or today), so the latest days are in view.
  const [first, setFirst] = useState(() => addMonths(monthStart(to ?? from ?? today()), -1));
  const [focused, setFocused] = useState(() => to ?? from ?? today());
  const [hover, setHover] = useState<string | null>(null);
  const [moves, setMoves] = useState(autoFocus ? 1 : 0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (moves > 0) root.current?.querySelector<HTMLButtonElement>("button[tabindex='0']")?.focus();
  }, [moves]);

  const go = (day: string) => {
    setFocused(day);
    // Keep the focused day on screen: past the right month the pair moves on, before the left one it moves back.
    if (monthStart(day) > addMonths(first, 1)) setFirst(addMonths(monthStart(day), -1));
    else if (monthStart(day) < first) setFirst(monthStart(day));
    setMoves((n) => n + 1);
  };
  // While only the start is chosen, the shading follows the pointer to show the range a press would make.
  const end = to ?? (from && hover && hover >= from ? hover : null);
  const now = today();

  const onKeyDown = (event: KeyboardEvent) => {
    const target = dayForKey(focused, event);
    if (target) {
      event.preventDefault();
      go(target);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPick(focused);
    }
  };

  const month = (start: string, second: boolean) => (
    <div className={cx("flex w-[17.5rem] max-w-full flex-col gap-2", !second && "max-sm:hidden")}>
      <p
        aria-live="polite"
        className="flex h-8 items-center justify-center text-sm font-medium text-ink"
      >
        {MONTH.format(toTime(start))}
      </p>
      <table
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the ARIA date picker grid pattern (APG)
        role="grid"
        aria-label={`${label}, ${MONTH.format(toTime(start))}`}
        onKeyDown={onKeyDown}
        className="w-full border-collapse"
      >
        <thead>
          <tr>
            {WEEK.map((day) => (
              <th key={day} scope="col" className="pb-1 text-center text-xs font-normal text-muted">
                {WEEKDAY.format(toTime(day)).slice(0, 2)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }, (_, row) => {
            const days = monthGrid(start).slice(row * 7, row * 7 + 7);
            return (
              <tr key={days[0]}>
                {days.map((day) => {
                  // Another month's days stay blank, so each day shows once across the pair.
                  if (monthStart(day) !== start) return <td key={day} />;
                  const edge = day === from || day === end;
                  const inside = Boolean(from && end && day > from && day < end);
                  return (
                    // biome-ignore lint/a11y/useFocusableInteractive: focus goes to the button inside (one tab stop)
                    <td
                      key={day}
                      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the ARIA date picker grid pattern (APG)
                      role="gridcell"
                      aria-selected={edge || inside}
                      className={cx("p-0 py-0.5 text-center", inside && "bg-surface-2")}
                    >
                      <button
                        type="button"
                        tabIndex={day === focused ? 0 : -1}
                        aria-label={FULL_DATE.format(toTime(day))}
                        aria-current={day === now ? "date" : undefined}
                        onPointerEnter={() => setHover(day)}
                        onClick={() => {
                          go(day);
                          onPick(day);
                        }}
                        className={cx(
                          "grid size-9 w-full place-items-center rounded-md text-sm tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-focus",
                          edge
                            ? "bg-primary font-medium text-on-primary"
                            : "text-ink hover:bg-surface-2",
                          day === now && !edge && "ring-1 ring-line-strong ring-inset",
                        )}
                      >
                        {Number(day.slice(8))}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div ref={root} className="relative flex gap-6" onPointerLeave={() => setHover(null)}>
      <div className="absolute top-0 left-0">
        <IconButton label="Previous month" onClick={() => setFirst(addMonths(first, -1))}>
          <ChevronLeft aria-hidden className="size-[var(--fw-icon-sm)]" />
        </IconButton>
      </div>
      <div className="absolute top-0 right-0">
        <IconButton label="Next month" onClick={() => setFirst(addMonths(first, 1))}>
          <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)]" />
        </IconButton>
      </div>
      {month(first, false)}
      {month(addMonths(first, 1), true)}
    </div>
  );
}
