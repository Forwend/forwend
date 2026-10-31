import { describe, expect, it } from "vitest";
import { priceCart, usd } from "@/lib/catalog";

describe("priceCart", () => {
  it("prices from the catalog and ignores any price the browser sends", () => {
    const cart = priceCart([
      { id: "beans", quantity: 2, cents: 1, price: "0.01" },
      { id: "mug", quantity: 1 },
    ]);
    expect(cart?.totalCents).toBe(2 * 2400 + 1250);
    expect(cart?.lines.map((l) => l.cents)).toEqual([2400, 1250]);
  });

  it("refuses unknown items, repeats and quantities out of 1 to 10", () => {
    for (const lines of [
      [],
      [{ id: "gold", quantity: 1 }],
      [{ id: "toString", quantity: 1 }],
      [{ id: "mug", quantity: 0 }],
      [{ id: "mug", quantity: 11 }],
      [{ id: "mug", quantity: 1.5 }],
      [{ id: "mug", quantity: "2" }],
      [
        { id: "mug", quantity: 1 },
        { id: "mug", quantity: 1 },
      ],
      "mug",
      null,
    ]) {
      expect(priceCart(lines), JSON.stringify(lines)).toBeNull();
    }
  });

  it("writes cents as the API's USD", () => {
    expect([usd(2450), usd(5), usd(100000)]).toEqual(["24.50", "0.05", "1000.00"]);
  });
});
