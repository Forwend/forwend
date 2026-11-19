import { addDays, addMonths, weekday } from "./iso-date";

export const MONTH = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
export const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });
export const FULL_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeZone: "UTC" });
// 2024-01-01 is a Monday: the header reads Monday to Sunday in the viewer's language.
export const WEEK = Array.from({ length: 7 }, (_, i) => addDays("2024-01-01", i));

/** The day a grid key moves to from the focused one (ARIA date grid keys), or undefined for any other key. */
export function dayForKey(
  focused: string,
  { key, shiftKey }: { key: string; shiftKey: boolean },
): string | undefined {
  const targets: Record<string, string> = {
    ArrowLeft: addDays(focused, -1),
    ArrowRight: addDays(focused, 1),
    ArrowUp: addDays(focused, -7),
    ArrowDown: addDays(focused, 7),
    PageUp: addMonths(focused, shiftKey ? -12 : -1),
    PageDown: addMonths(focused, shiftKey ? 12 : 1),
    Home: addDays(focused, -weekday(focused)),
    End: addDays(focused, 6 - weekday(focused)),
  };
  return targets[key];
}
