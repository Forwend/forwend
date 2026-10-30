import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { PaymentProblems } from "@/features/payments/components/payment-problems";
import { optionFigures, paymentState, paymentWallet } from "@/features/payments/lib/payments";

describe("merchant payment money", () => {
  it("keeps large base units, negative changes and subcent precision exact", () => {
    for (const [amount, expected] of [
      ["10000000000000000007", "10.000000000000000007"],
      ["-10000000000000000007", "-10.000000000000000007"],
      ["1", "0.000000000000000001"],
    ] as const) {
      const markup = renderToStaticMarkup(
        <PaymentAmount amount={amount} decimals={18} symbol="USDC" />,
      );
      expect(markup).toContain(expected);
    }
  });
  it("keeps confirmed payment separate from settlement into a wallet", () => {
    expect(paymentState({ paymentStatus: "paid", closed: false })).toBe("Paid");
    expect(paymentState({ paymentStatus: "detected", closed: true })).toBe("Expired");
    expect(paymentWallet({ settlementStatus: "pending" })).toBe("pending");
    expect(paymentWallet({ settlementStatus: "settled" })).toBe("inWallet");
    expect(paymentWallet({ settlementStatus: "none" })).toBe("none");
    expect(
      paymentState({ paymentStatus: "paid", closed: false, amounts: { held: "1" } as never }),
    ).toBe("Overpaid");
    expect(paymentState({ paymentStatus: "partially_paid", closed: true })).not.toBe("Paid");
  });
});

describe("optionFigures", () => {
  const receipt = { received: "0", pending: "0", held: "0" };
  it("names money over the request, before and after the ledger books it", () => {
    // 1.00 sent for a 0.10 request, still confirming: 0.90 over, nothing booked yet.
    expect(
      optionFigures("100000", { ...receipt, received: "1000000", pending: "1000000" }),
    ).toEqual({ received: 1000000n, confirming: 1000000n, extra: 900000n, due: 0n });
    // Booked: the held amount is the extra, even when late money makes it differ from the arithmetic.
    expect(optionFigures("100000", { ...receipt, received: "100000", held: "100000" })).toEqual({
      received: 100000n,
      confirming: 0n,
      extra: 100000n,
      due: 0n,
    });
  });
  it("leaves what is still due, and nothing when no receipt exists", () => {
    expect(optionFigures("100000", { ...receipt, received: "40000" })).toMatchObject({
      extra: 0n,
      due: 60000n,
    });
    expect(optionFigures("100000", undefined)).toEqual({
      received: 0n,
      confirming: 0n,
      extra: 0n,
      due: 100000n,
    });
  });
});

describe("payment page problems", () => {
  const problem = (code: string, action = "review_funds", extra: Record<string, unknown> = {}) => ({
    amount: null,
    asset: null,
    code,
    action,
    optionId: null,
    endpointId: null,
    eventId: null,
    reason: null,
    ...extra,
  });
  const asset = { chainId: 421614, token: `0x${"1".repeat(40)}`, symbol: "USDC", decimals: 6 };
  it("shows only the problems the rest of the page doesn't say", () => {
    const markup = renderToStaticMarkup(
      <PaymentProblems
        problems={[
          problem("settlement_refused", "review_settlement"),
          problem("partial_payment", "share_checkout"),
          problem("settlement_delayed", "wait"),
          problem("reconciliation_required"),
          problem("funds_movement_exception"),
          problem("webhook_delivery", "review_webhooks"),
        ]}
      />,
    );
    expect(markup).toContain("Payment records need review");
    expect(markup).toContain("Unexpected transfer");
    expect(markup).toContain("Webhook delivery failed or paused");
    expect(markup).toContain("Check webhooks");
    expect(markup).not.toContain("Wallet transfer refused");
    expect(markup).not.toContain("Partially paid");
    expect(markup).not.toContain("owed");
  });
  it("says one failing webhook endpoint once, however many events it failed", () => {
    const markup = renderToStaticMarkup(
      <PaymentProblems
        problems={[
          problem("webhook_delivery", "review_webhooks", { eventId: "a", endpointId: "1" }),
          problem("webhook_delivery", "review_webhooks", { eventId: "b", endpointId: "1" }),
        ]}
      />,
    );
    expect(markup.match(/Webhook delivery failed/g)).toHaveLength(1);
  });
  it("leaves held money to Amount only for the option Amount shows", () => {
    const held = (optionId: string) =>
      problem("held_funds", "review_funds", { optionId, amount: "2000000", asset });
    const a = `0x${"a".repeat(64)}`;
    const b = `0x${"b".repeat(64)}`;
    expect(renderToStaticMarkup(<PaymentProblems problems={[held(a)]} extraShown={a} />)).toBe("");
    const other = renderToStaticMarkup(<PaymentProblems problems={[held(b)]} extraShown={a} />);
    expect(other).toContain("Money held for the payer");
    expect(other).toContain("2.00");
  });
});
