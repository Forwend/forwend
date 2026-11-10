import { describe, expect, it } from "vitest";
import { dayName, dayTime, timeOfDay } from "@/shared/lib/dates";

const NOW = new Date(2026, 10, 10, 18, 0);
const at = (...parts: [number, number, number, number, number]) => new Date(...parts).toISOString();

describe("a list row's day and time", () => {
  it("names today and yesterday, else the date, with the year only in another year", () => {
    const today = at(2026, 10, 10, 14, 14);
    expect(dayTime(today, NOW)).toBe(`Today, ${timeOfDay(today)}`);
    expect(dayTime(at(2026, 10, 9, 0, 5), NOW)).toMatch(/^Yesterday, /);
    expect(dayTime(at(2026, 10, 6, 16, 55), NOW)).toMatch(/^Nov 6, /);
    expect(dayTime(at(2025, 10, 6, 16, 55), NOW)).toMatch(/^Nov 6, 2025, /);
  });

  it("heads a phone list's day with its weekday", () => {
    expect(dayName(at(2026, 10, 10, 0, 0), NOW)).toBe("Today");
    expect(dayName(at(2026, 10, 9, 23, 59), NOW)).toBe("Yesterday");
    expect(dayName(at(2026, 10, 6, 9, 0), NOW)).toBe("Fri, Nov 6");
    expect(dayName(at(2025, 10, 6, 9, 0), NOW)).toBe("Thu, Nov 6, 2025");
  });
});
