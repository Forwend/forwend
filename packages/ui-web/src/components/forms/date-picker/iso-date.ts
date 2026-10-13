// Dates as ISO "YYYY-MM-DD" strings, computed in UTC: the value a picker gives never depends on the viewer's time zone
// or locale. Weeks start on Monday (ISO 8601).

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Milliseconds at UTC midnight of an ISO date, or NaN for anything else. */
export function toTime(iso: string): number {
  const m = ISO_DATE.exec(iso);
  if (!m) return Number.NaN;
  const time = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return toIso(time) === iso ? time : Number.NaN; // rejects 2026-02-30
}

export function toIso(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** Today in the viewer's calendar, as an ISO date. */
export function today(now: Date = new Date()): string {
  return toIso(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function addDays(iso: string, days: number): string {
  return toIso(toTime(iso) + days * DAY_MS);
}

/** The same day in a month n away, clamped to that month's last day (Jan 31 + 1 month = Feb 28). */
export function addMonths(iso: string, months: number): string {
  const d = new Date(toTime(iso));
  const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0)).getUTCDate();
  return toIso(first + (Math.min(d.getUTCDate(), last) - 1) * DAY_MS);
}

/** 0 for Monday … 6 for Sunday. */
export function weekday(iso: string): number {
  return (new Date(toTime(iso)).getUTCDay() + 6) % 7;
}

/** The first day of the month that holds iso. */
export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** The six Monday-first weeks shown for the month of iso, as 42 ISO dates. */
export function monthGrid(iso: string): string[] {
  const first = monthStart(iso);
  const start = addDays(first, -weekday(first));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function clamp(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}
