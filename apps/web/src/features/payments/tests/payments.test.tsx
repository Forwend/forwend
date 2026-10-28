import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { paymentState, paymentWallet } from "@/features/payments/lib/payments";

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
