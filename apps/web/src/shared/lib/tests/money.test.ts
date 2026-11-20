import { describe, expect, it } from "vitest";
import { amountText, exactAmount, usdCents, usdFromCents } from "@/shared/lib/money";

describe("USD cents", () => {
  it("reads a USD decimal as exact cents and writes cents back with 2 decimals", () => {
    expect(usdCents("25")).toBe(2500n);
    expect(usdCents("25.5")).toBe(2550n);
    expect(usdCents("1000000.05")).toBe(100000005n);
    expect(usdFromCents(30005n)).toBe("300.05");
    expect(usdFromCents(7n)).toBe("0.07");
  });
});

describe("exact amounts", () => {
  it("shows every decimal an amount has, and at least 2", () => {
    expect(exactAmount(1n, 6)).toBe("0.000001");
    expect(exactAmount(1_234_560_000n, 6)).toBe("1,234.56");
    expect(exactAmount(1_123_000n, 6)).toBe("1.123");
    expect(exactAmount(1_200_000n, 6)).toBe("1.20");
    expect(exactAmount(5n, 0)).toBe("5");
    expect(amountText(1_200_000n, { decimals: 6, symbol: "USDC" })).toBe("1.20 USDC");
  });
});
