import { DATES_COPY } from "@/shared/constants/dates-copy";

const DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DAY_YEAR = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const TIME = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const DAY_TIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const WEEKDAY = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const WEEKDAY_YEAR = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function relativeDay(date: Date, now: Date): string | null {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return date.toDateString() === now.toDateString()
    ? DATES_COPY.today
    : date.toDateString() === yesterday.toDateString()
      ? DATES_COPY.yesterday
      : null;
}

/** "Oct 27" in this year, "Oct 27, 2025" otherwise: a list row's date. */
export function shortDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  return (date.getFullYear() === now.getFullYear() ? DAY : DAY_YEAR).format(date);
}

/** "Oct 27, 2026, 3:35 PM": a detail page's time. */
export function dateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

/** A time on a page that already shows the day it began: "3:35 PM" on that day, "Oct 28, 3:35 PM" on another, and
 * the full date in another year. */
export function timeNear(iso: string, day: string): string {
  const date = new Date(iso);
  const near = new Date(day);
  if (date.getFullYear() !== near.getFullYear()) return DATE_TIME.format(date);
  return (date.toDateString() === near.toDateString() ? TIME : DAY_TIME).format(date);
}

/** "2:14 PM": a row's time under its day's heading. */
export function timeOfDay(iso: string): string {
  return TIME.format(new Date(iso));
}

/** "Today, 2:14 PM", "Yesterday, 6:40 PM", else "Nov 6, 4:55 PM", with the year in another year: a list row's time. */
export function dayTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  return `${relativeDay(date, now) ?? shortDate(iso, now)}, ${TIME.format(date)}`;
}

/** "Today", "Yesterday", else "Fri, Nov 6", with the year in another year: a phone list's day heading. */
export function dayName(iso: string, now = new Date()): string {
  const date = new Date(iso);
  return (
    relativeDay(date, now) ??
    (date.getFullYear() === now.getFullYear() ? WEEKDAY : WEEKDAY_YEAR).format(date)
  );
}
