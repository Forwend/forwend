import { describe, expect, it } from "vitest";
import { formatTokenAmount } from "./token-amount";

describe("formatTokenAmount", () => {
  it("formats USDC base units with grouping and two decimals", () => {
    expect(formatTokenAmount({ baseUnits: 1234560000n, decimals: 6 })).toBe("1,234.56");
  });

  it("cuts extra digits instead of rounding up", () => {
    expect(formatTokenAmount({ baseUnits: 999999n, decimals: 6 })).toBe("0.99");
  });

  it("keeps precision beyond Number.MAX_SAFE_INTEGER", () => {
    expect(formatTokenAmount({ baseUnits: 123456789012345678901234n, decimals: 6 })).toBe(
      "123,456,789,012,345,678.90",
    );
  });

  it("handles 18-decimal tokens and negatives", () => {
    expect(formatTokenAmount({ baseUnits: -1500000000000000000n, decimals: 18 })).toBe("-1.50");
  });

  it("does not print negative zero", () => {
    expect(formatTokenAmount({ baseUnits: -1n, decimals: 6 })).toBe("0.00");
  });
});
