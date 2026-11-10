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
