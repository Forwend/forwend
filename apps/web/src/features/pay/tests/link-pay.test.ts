import { describe, expect, it } from "vitest";
import { purchaseSearch, readPurchase } from "@/features/pay/lib/link-pay";

const key = "eeeeeeee-0000-4000-8000-000000000042:2500";

describe("purchase retry identity", () => {
  it("retains the original fixed or entered amount across a reload", () => {
    for (const amountUsd of [null, "25.00"]) {
      const purchase = { idempotencyKey: key, cents: "2500", amountUsd, offerVersion: "1" };
      const search = purchaseSearch("?campaign=summer", purchase);
      expect(readPurchase(search)).toEqual(purchase);
      expect(new URLSearchParams(search).get("campaign")).toBe("summer");
      expect(purchaseSearch(search, null)).toBe("campaign=summer");
    }
  });

  it("rejects malformed identities and mismatched amount displays", () => {
    for (const search of [
      "",
      "?purchase=invalid",
      `?purchase=${key}&amount=26`,
      `?purchase=${key}&amount=25.001`,
      `?purchase=${key.replace(":2500", ":0")}`,
    ]) {
      expect(readPurchase(search)).toBeNull();
    }
  });
});
