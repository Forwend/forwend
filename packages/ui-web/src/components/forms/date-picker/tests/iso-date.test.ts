import { describe, expect, it } from "vitest";
import { clamp, toTime } from "../iso-date";

describe("ISO dates", () => {
  it("rejects anything that is not a real calendar date", () => {
    expect(Number.isNaN(toTime("2026-02-30"))).toBe(true);
    expect(Number.isNaN(toTime("13/10/2026"))).toBe(true);
    expect(toTime("2028-02-29")).toBe(Date.UTC(2028, 1, 29));
  });
  it("keeps a date inside min and max", () => {
    expect(clamp("2026-01-01", "2026-02-01", "2026-03-01")).toBe("2026-02-01");
    expect(clamp("2026-04-01", "2026-02-01", "2026-03-01")).toBe("2026-03-01");
  });
});
