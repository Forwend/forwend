import { describe, expect, it } from "vitest";
import { dueCheckoutDate, feeFigures, lineUnits } from "@/features/invoices/lib/new-invoice";

describe("lineUnits", () => {
  const line = (quantity: string, price: string) =>
    lineUnits({ description: "Design", quantity, price }, 6);
  it("multiplies a quantity with up to 2 decimals by the price, exactly", () => {
    expect(line("7.5", "0.50")).toEqual({ price: 500_000n, units: 3_750_000n });
    expect(line("1", "1250")).toEqual({ price: 1_250_000_000n, units: 1_250_000_000n });
    expect(line("3", "0")).toEqual({ price: 0n, units: 0n });
  });

  it("names what is wrong with a line", () => {
    expect(lineUnits({ description: " ", quantity: "1", price: "1" }, 6)).toBe("description");
    expect(line("0", "1")).toBe("quantity");
    expect(line("1.005", "1")).toBe("quantity");
    expect(line("1000001", "1")).toBe("quantity");
    expect(line("1", "1.0000001")).toBe("price");
    expect(line("0.5", "0.000001")).toBe("exact");
  });
});

describe("dueCheckoutDate", () => {
  it("is the due date plus 60 days, across month, year and leap-day boundaries", () => {
    expect(dueCheckoutDate("2026-11-15", "2026-10-17")).toBe("2027-01-14");
    expect(dueCheckoutDate("2027-12-31", "2027-10-17")).toBe("2028-02-29");
  });

  it("stops at 364 days from today, so the close stays within the 365 days a checkout can last", () => {
    expect(dueCheckoutDate("2027-09-01", "2026-10-17")).toBe("2027-10-16");
  });
});

describe("feeFigures", () => {
  const option = (networkFee: string, decimals = 6) => ({
    chainId: 84532,
    token: `0x${"1".repeat(40)}`,
    decimals,
    price: "5000000",
    networkFee,
    platformFee: "0",
  });
  const quote = {
    feesPaidBy: "owner" as const,
    options: [option("9", 18), option("50000"), option("50000")],
  };

  it("adds the fees to what the client pays, or takes them from what the owner receives", () => {
    expect(feeFigures(quote, 6, true)).toEqual({
      fee: 50000n,
      pays: 5050000n,
      receives: 5000000n,
      platform: false,
    });
    expect(feeFigures(quote, 6, false)).toEqual({
      fee: 50000n,
      pays: 5000000n,
      receives: 4950000n,
      platform: false,
    });
  });

  it("has nothing to say before a quote, or for options in other units", () => {
    expect(feeFigures(undefined, 6, true)).toBeNull();
    expect(feeFigures(quote, 2, true)).toBeNull();
  });
});
