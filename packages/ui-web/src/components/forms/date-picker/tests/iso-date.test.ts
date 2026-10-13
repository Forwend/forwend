import { describe, expect, it } from "vitest";
import { addDays, addMonths, clamp, monthGrid, toTime, weekday } from "../iso-date";

describe("ISO dates", () => {
  it("rejects anything that is not a real calendar date", () => {
    expect(Number.isNaN(toTime("2026-02-30"))).toBe(true);
    expect(Number.isNaN(toTime("13/10/2026"))).toBe(true);
    expect(toTime("2028-02-29")).toBe(Date.UTC(2028, 1, 29));
  });
  it("moves by days across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("moves by months to the same day, or the month's last day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-10-13", -12)).toBe("2025-10-13");
  });
  it("starts weeks on Monday and shows six of them", () => {
    expect(weekday("2026-10-12")).toBe(0); // a Monday
    expect(weekday("2026-10-18")).toBe(6);
    const grid = monthGrid("2026-10-13");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-09-28");
    expect(grid).toContain("2026-10-31");
  });
  it("keeps a date inside min and max", () => {
    expect(clamp("2026-01-01", "2026-02-01", "2026-03-01")).toBe("2026-02-01");
    expect(clamp("2026-04-01", "2026-02-01", "2026-03-01")).toBe("2026-03-01");
  });
});
