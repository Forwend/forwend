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
  closed: false,
  held: false,
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

  it("keeps the customer payment state independent of its wallet transfer", () => {
    expect(activityStatus(base)).toBe(PAYMENT_STATUS.open);
    expect(activityStatus({ ...base, status: "detected" })).toBe(PAYMENT_STATUS.confirming);
    expect(activityStatus({ ...base, status: "partially_paid" })).toBe(
      PAYMENT_STATUS.partiallyPaid,
    );
    expect(activityStatus({ ...base, status: "paid", settlementStatus: "pending" })).toBe(
      PAYMENT_STATUS.paid,
    );
    expect(activityStatus({ ...base, status: "paid", settlementStatus: "settled" })).toBe(
      PAYMENT_STATUS.paid,
    );
    expect(activityStatus({ ...base, status: "expired_partially_paid" })).toBe(
      PAYMENT_STATUS.expiredPartiallyPaid,
    );
  });

  it("reads open and partly paid as expired once the API says the checkout closed (R-77)", () => {
    const closed = { ...base, closed: true };
    expect(activityStatus(closed)).toBe(PAYMENT_STATUS.expired);
    expect(activityStatus({ ...closed, status: "partially_paid" })).toBe(
      PAYMENT_STATUS.expiredPartiallyPaid,
    );
    expect(activityStatus({ ...closed, status: "detected" })).toBe(PAYMENT_STATUS.expired);
    expect(activityStatus({ ...closed, status: "paid" })).toBe(PAYMENT_STATUS.paid);
    expect(activityStatus({ ...base, status: "partially_paid" })).toBe(
      PAYMENT_STATUS.partiallyPaid,
    );
  });

  it("shows a canceled invoice as canceled, closed or not (R-79)", () => {
    expect(activityStatus({ ...base, status: "canceled" })).toBe(PAYMENT_STATUS.canceled);
    expect(activityStatus({ ...base, status: "canceled", closed: true })).toBe(
      PAYMENT_STATUS.canceled,
    );
  });

  it("does not treat a confirmed but uncredited deposit as paid", () => {
    expect(
      activityStatus({
        ...base,
        kind: "deposit",
        status: "confirmed",
        paymentStatus: "open",
        confirming: true,
      }),
    ).toBe(PAYMENT_STATUS.confirming);
    expect(
      activityStatus({
        ...base,
        kind: "deposit",
        status: "confirmed",
        paymentStatus: "partially_paid",
        confirming: true,
      }),
    ).toBe(PAYMENT_STATUS.confirming);
  });

  it("never claims money arrived for a status it does not know", () => {
    expect(activityStatus({ ...base, status: "something_new" })).toBe(PAYMENT_STATUS.detected);
  });
});
