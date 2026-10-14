import { PAYMENT_STATUS } from "@forwend/ui-web";
import { describe, expect, it } from "vitest";
import { activityStatus } from "@/features/activity/lib/activity";
import type { ActivityItem } from "@/features/activity/types/activity";

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
  optionCount: 1,
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
    expect(activityStatus({ ...base, status: "detected" })).toBe(PAYMENT_STATUS.confirming);
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

  it("reads open and partly paid as expired once the checkout closed, before the API's status does", () => {
    const at = Date.parse("2026-10-10T12:00:00Z");
    const closed = { ...base, expiresAt: "2026-10-10T11:59:59Z" };
    expect(activityStatus(closed, at)).toBe(PAYMENT_STATUS.expired);
    expect(activityStatus({ ...closed, status: "partially_paid" }, at)).toBe(
      PAYMENT_STATUS.expiredPartiallyPaid,
    );
    // A payment seen before expiry may still confirm, and paid stays paid.
    expect(activityStatus({ ...closed, status: "detected" }, at)).toBe(PAYMENT_STATUS.confirming);
    expect(activityStatus({ ...closed, status: "paid" }, at)).toBe(PAYMENT_STATUS.paid);
    expect(activityStatus({ ...base, expiresAt: "2026-10-10T12:00:01Z" }, at)).toBe(
      PAYMENT_STATUS.open,
    );
  });

  it("never claims money arrived for a status it does not know", () => {
    expect(activityStatus({ ...base, status: "something_new" })).toBe(PAYMENT_STATUS.detected);
  });
});
