import { PAYMENT_STATUS } from "@forwend/ui-web";
import { describe, expect, it } from "vitest";
import { type ActivityItem, activityStatus, filterActivity } from "@/features/activity/activity";

const base: ActivityItem = {
  kind: "invoice",
  at: "2026-10-10T10:00:00Z",
  invoiceId: `0x${"1".repeat(64)}`,
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
  amount: "5000000",
  status: "open",
  settlementStatus: "none",
};

describe("activityStatus", () => {
  it("shows a deposit as confirming until its block is final", () => {
    expect(activityStatus({ ...base, kind: "deposit", status: "detected" })).toBe(
      PAYMENT_STATUS.confirming,
    );
    expect(activityStatus({ ...base, kind: "deposit", status: "confirmed" })).toBe(
      PAYMENT_STATUS.confirmed,
    );
  });

  it("shows an invoice's payment status, and settled only once the money reached the wallet", () => {
    expect(activityStatus(base)).toBe(PAYMENT_STATUS.open);
    expect(activityStatus({ ...base, status: "partially_paid" })).toBe(
      PAYMENT_STATUS.partiallyPaid,
    );
    expect(activityStatus({ ...base, status: "paid", settlementStatus: "pending" })).toBe(
      PAYMENT_STATUS.paid,
    );
    expect(activityStatus({ ...base, status: "paid", settlementStatus: "settled" })).toBe(
      PAYMENT_STATUS.settled,
    );
    expect(activityStatus({ ...base, status: "expired_partially_paid" })).toBe(
      PAYMENT_STATUS.expiredPartiallyPaid,
    );
  });

  it("never claims money arrived for a status it does not know", () => {
    expect(activityStatus({ ...base, status: "something_new" })).toBe(PAYMENT_STATUS.detected);
  });
});

describe("filterActivity", () => {
  const items: ActivityItem[] = [
    { ...base, amount: "1250000000" },
    { ...base, kind: "deposit", status: "detected", txHash: `0x${"ab".repeat(32)}` },
    { ...base, kind: "deposit", status: "confirmed", chainId: 421614 },
    { ...base, status: "paid", settlementStatus: "settled" },
  ];
  const picked = (filter: Parameters<typeof filterActivity>[1], search = "") =>
    filterActivity(items, filter, search).map((item) => items.indexOf(item));

  it("puts confirming payments under open and confirmed ones under paid", () => {
    expect(picked("open")).toEqual([0, 1]);
    expect(picked("paid")).toEqual([2]);
    expect(picked("settled")).toEqual([3]);
    expect(picked("expired")).toEqual([]);
  });

  it("searches the amount without separators, the network and the transaction hash", () => {
    expect(picked("all", "1250")).toEqual([0]);
    expect(picked("all", "1,250.00")).toEqual([0]);
    expect(picked("all", "arbitrum")).toEqual([2]);
    expect(picked("all", "0xABAB")).toEqual([1]);
  });
});
