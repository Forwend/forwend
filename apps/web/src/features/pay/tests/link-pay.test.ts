import { describe, expect, it } from "vitest";
import { checkLinkAmount, purchaseSearch, readPurchase } from "@/features/pay/lib/link-pay";

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
      `?purchase=${key}&offer=0`,
      `?purchase=${key}&offer=9223372036854775808`,
    ]) {
      expect(readPurchase(search)).toBeNull();
    }
  });
});

describe("checkLinkAmount", () => {
  const open = { amountUsd: null, minUsd: "5.00", maxUsd: "50.00" };

  it("takes what the payer typed only within the link's limits", () => {
    expect(checkLinkAmount(open, "25.50")).toEqual({ cents: 2550n, error: "" });
    expect(checkLinkAmount(open, "5")).toEqual({ cents: 500n, error: "" });
    for (const typed of ["4.99", "50.01"]) expect(checkLinkAmount(open, typed).error).not.toBe("");
    const any = { amountUsd: null, minUsd: null, maxUsd: null };
    expect(checkLinkAmount(any, "1.00").error).toBe("");
    expect(checkLinkAmount(any, "0.99").error).not.toBe("");
  });

  it("refuses what is not an amount the API takes", () => {
    for (const typed of ["", "0", "abc", "1.234", "-5", null]) {
      expect(checkLinkAmount(open, typed)).toMatchObject({ cents: 0n });
      expect(checkLinkAmount(open, typed).error).not.toBe("");
    }
  });

  it("asks a fixed link's own amount, whatever was typed", () => {
    expect(checkLinkAmount({ amountUsd: "12.00", minUsd: null, maxUsd: null }, "999")).toEqual({
      cents: 1200n,
      error: "",
    });
  });
});
