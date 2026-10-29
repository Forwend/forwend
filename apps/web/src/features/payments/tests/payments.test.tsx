import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import {
  nextStep,
  optionFigures,
  paymentState,
  paymentWallet,
} from "@/features/payments/lib/payments";
import type { PaymentDetail } from "@/features/payments/types/payments";

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

describe("nextStep", () => {
  const refunded = (paymentStatus: string, closed: boolean) =>
    ({
      problems: [],
      refundStatus: "refunded",
      paymentStatus,
      closed,
      confirming: false,
      settlementStatus: "none",
      options: [],
      snapshotAt: "2026-10-29T12:00:00Z",
    }) as unknown as PaymentDetail;

  it("calls a refunded payment complete only when it was paid", () => {
    expect(nextStep(refunded("partially_paid", true))).toBe(
      "The money received was returned to the payer.",
    );
    expect(nextStep(refunded("paid", false))).toBe(
      "Paid. The extra money was returned to the payer.",
    );
  });
});
