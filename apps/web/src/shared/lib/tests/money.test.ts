import { describe, expect, it } from "vitest";
import { exactDigits, usdCents, usdFromCents } from "@/shared/lib/money";

describe("USD cents", () => {
  it("reads a USD decimal as exact cents and writes cents back with 2 decimals", () => {
    expect(usdCents("25")).toBe(2500n);
    expect(usdCents("25.5")).toBe(2550n);
    expect(usdCents("1000000.05")).toBe(100000005n);
    expect(usdFromCents(30005n)).toBe("300.05");
    expect(usdFromCents(7n)).toBe("0.07");
  });
});

describe("exactDigits", () => {
  it("shows every decimal an amount has, and at least 2", () => {
    expect(exactDigits(1n, 6)).toBe(6);
    expect(exactDigits(1_234_560_000n, 6)).toBe(2);
    expect(exactDigits(1_123_000n, 6)).toBe(3);
    expect(exactDigits(5n, 0)).toBe(0);
  });
});
