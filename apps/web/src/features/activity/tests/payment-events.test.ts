import { describe, expect, it } from "vitest";
import { PAYMENT_EVENTS } from "@/features/activity/constants/payment-events";
import { newPaymentEvents } from "@/features/activity/lib/payment-events";
import type { InvoiceEvent } from "@/features/invoices/types/invoices";

const item = (id: number, kind: string, number: number | null = null): InvoiceEvent => ({
  id,
  kind,
  number,
  at: "2026-10-11T10:00:00Z",
  invoiceId: "0xinv1",
  chainId: 84532,
  token: "0xtoken",
  symbol: "USDC",
  decimals: 6,
  amount: "12500000",
});

describe("newPaymentEvents", () => {
  it("does not announce existing events, repeats or events returning to the page", () => {
    const paid = item(1, "invoice.paid");
    const { seen, events } = newPaymentEvents(undefined, [paid]);
    expect(events).toEqual([]);
    expect(newPaymentEvents(seen, [paid]).events).toEqual([]);
    newPaymentEvents(seen, []);
    expect(newPaymentEvents(seen, [paid]).events).toEqual([]);
  });

  it("announces paid and wallet arrival separately for checkout and invoice records", () => {
    for (const number of [null, 1]) {
      const { seen } = newPaymentEvents(undefined, []);
      const paid = item(1, "invoice.paid", number);
      const settled = item(2, "invoice.settled", number);
      expect(newPaymentEvents(seen, [paid]).events).toEqual([
        { kind: PAYMENT_EVENTS.paid, item: paid },
      ]);
      expect(newPaymentEvents(seen, [settled, paid]).events).toEqual([
        { kind: PAYMENT_EVENTS.settled, item: settled },
      ]);
      expect(newPaymentEvents(seen, [settled, paid]).events).toEqual([]);
    }
  });

  it("never announces held money, delivery errors or unknown events as payment success", () => {
    const { seen } = newPaymentEvents(undefined, []);
    expect(
      newPaymentEvents(seen, [
        item(1, "invoice.held"),
        item(2, "invoice.email_failed"),
        item(3, "unknown"),
      ]).events,
    ).toEqual([]);
  });
});
