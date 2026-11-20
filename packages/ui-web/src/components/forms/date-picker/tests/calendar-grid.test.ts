import { describe, expect, it } from "vitest";
import { dayForKey } from "../calendar-grid";

describe("calendar keys", () => {
  const key = (name: string, shiftKey = false) => dayForKey("2026-03-31", { key: name, shiftKey });
  it("moves a day, a week or a month, and a year with Shift", () => {
    expect(key("ArrowRight")).toBe("2026-04-01");
    expect(key("ArrowUp")).toBe("2026-03-24");
    expect(key("PageDown")).toBe("2026-04-30");
    expect(key("PageUp", true)).toBe("2025-03-31");
    expect(key("PageDown", true)).toBe("2027-03-31");
    expect(key("a")).toBeUndefined();
  });
});
