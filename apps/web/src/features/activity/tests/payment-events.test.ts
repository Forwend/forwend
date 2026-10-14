import { describe, expect, it } from "vitest";
import { PAYMENT_EVENTS } from "@/features/activity/constants/payment-events";
import { newPaymentEvents } from "@/features/activity/lib/payment-events";
import type { ActivityItem } from "@/features/activity/types/activity";

const item = (over: Partial<ActivityItem>): ActivityItem => ({
  kind: "invoice",
  at: "2026-10-11T10:00:00Z",
  invoiceId: "0xinv1",
  chainId: 84532,
  token: "0xtoken",
  symbol: "USDC",
  decimals: 6,
  amount: "12500000",
  status: "open",
  settlementStatus: "none",
  optionCount: 1,
  closed: false,
  ...over,
});
const deposit = (txHash: string, invoiceId = "0xinv1") =>
  item({ kind: "deposit", invoiceId, status: "detected", txHash, settlementStatus: undefined });
const settled = (invoiceId = "0xinv1") =>
  item({ invoiceId, status: "paid", settlementStatus: "settled" });

describe("newPaymentEvents", () => {
  it("shows nothing for payments already there on the first load", () => {
    const { events, seen } = newPaymentEvents(undefined, [deposit("0xa"), settled()]);
    expect(events).toEqual([]);
    expect(newPaymentEvents(seen, [deposit("0xa"), settled()]).events).toEqual([]);
  });

  it("shows a new deposit as detected and a newly settled invoice as settled, once each", () => {
    let { seen } = newPaymentEvents(undefined, [item({})]);
    const paid = deposit("0xb");
    const first = newPaymentEvents(seen, [paid, item({ status: "detected" })]);
    expect(first.events).toEqual([{ kind: PAYMENT_EVENTS.detected, item: paid }]);
    seen = first.seen;
    const second = newPaymentEvents(seen, [paid, settled()]);
    expect(second.events).toEqual([{ kind: PAYMENT_EVENTS.settled, item: settled() }]);
    expect(newPaymentEvents(second.seen, [paid, settled()]).events).toEqual([]);
  });

  it("does not repeat a payment that left the page and came back", () => {
    const { seen } = newPaymentEvents(undefined, []);
    const once = newPaymentEvents(seen, [deposit("0xc")]);
    expect(once.events).toHaveLength(1);
    newPaymentEvents(once.seen, []);
    expect(newPaymentEvents(once.seen, [deposit("0xc")]).events).toEqual([]);
  });

  it("ignores invoices that are not settled", () => {
    const { seen } = newPaymentEvents(undefined, []);
    expect(
      newPaymentEvents(seen, [item({ status: "paid", settlementStatus: "pending" })]).events,
    ).toEqual([]);
  });
});
