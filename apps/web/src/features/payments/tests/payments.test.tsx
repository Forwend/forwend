import { PAYMENT_STATUSES } from "@forwend/ui-web";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { PaymentReceived } from "@/features/payments/components/payment-received";
import { health } from "@/features/payments/components/payment-reconciliation";
import { HELD_REASONS } from "@/features/payments/constants/payments";
import {
  PAYMENT_DETAIL_COPY,
  RECONCILIATION_COPY,
} from "@/features/payments/constants/payments-copy";
import {
  heldHint,
  leadOption,
  optionFigures,
  paymentDisplayStatus,
  receivedAmount,
} from "@/features/payments/lib/payments";
import { walletStateOf } from "@/shared/lib/payment-state";

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
    const status = (payment: Parameters<typeof paymentDisplayStatus>[0]) =>
      PAYMENT_STATUSES[paymentDisplayStatus(payment)].label;
    expect(status({ paymentStatus: "paid", closed: false })).toBe("Paid");
    expect(status({ paymentStatus: "detected", closed: true })).toBe("Closed unpaid");
    expect(walletStateOf({ settlementStatus: "pending" })).toBe("pending");
    expect(walletStateOf({ settlementStatus: "settled" })).toBe("inWallet");
    expect(walletStateOf({ settlementStatus: "none" })).toBe("none");
    expect(status({ paymentStatus: "paid", closed: false, amounts: { held: "1" } as never })).toBe(
      "Overpaid",
    );
    expect(status({ paymentStatus: "partially_paid", closed: true })).not.toBe("Paid");
  });
});

describe("a payment row's amount", () => {
  const payment = {
    amount: "1230000",
    decimals: 6,
    symbol: "USDC",
    optionCount: 1,
    optionId: "a",
    optionLocked: false,
    paymentStatus: "partially_paid",
    receipts: [
      {
        optionId: "a",
        chainId: 8453,
        token: "0x",
        symbol: "USDC",
        decimals: 6,
        received: "500000",
        pending: "0",
      },
    ],
    amounts: {} as never,
  };
  const text = (p: typeof payment) =>
    renderToStaticMarkup(<PaymentReceived payment={p} compact />).replace(/<[^>]+>/g, "");

  it("says what arrived of what was asked, and only the asked amount while they match", () => {
    expect(text(payment)).toBe("0.50 of 1.23 USDC");
    const paid = { ...payment, receipts: [{ ...payment.receipts[0], received: "1230000" }] };
    expect(text(paid as typeof payment)).toBe("1.23 USDC");
  });

  it("compares a USD request with a token of other decimals at their own scale", () => {
    const usd = {
      ...payment,
      decimals: 2,
      amount: "123",
      optionCount: 2,
      receipts: [{ ...payment.receipts[0], received: "1230000" }],
    };
    expect(text(usd as typeof payment)).toBe("1.23 USD");
    expect(text({ ...usd, amount: "100" } as typeof payment)).toMatch(/^1\.23 USDC of 1\.00 USD/);
  });
});

describe("receivedAmount", () => {
  it("counts the fees settlement paid, so a settled payment with fees still shows all it received", () => {
    const settled = {
      receiver: "0",
      payable: "0",
      held: "1000000",
      settled: "4950000",
      fees: "50000",
      refunded: "0",
      observedRefunded: "0",
      lastReturnTxHash: null,
      unreconciled: false,
    };
    expect(receivedAmount(settled)).toBe("6000000");
  });
});

describe("optionFigures", () => {
  const receipt = { received: "0", pending: "0", held: "0" };
  it("names money over the request, before and after the ledger books it", () => {
    expect(
      optionFigures("100000", { ...receipt, received: "1000000", pending: "1000000" }),
    ).toEqual({ received: 1000000n, extra: 900000n, due: 0n });
    expect(optionFigures("100000", { ...receipt, received: "100000", held: "100000" })).toEqual({
      received: 100000n,
      extra: 100000n,
      due: 0n,
    });
  });
  it("shows no extra once the held money went back to the payer", () => {
    expect(optionFigures("100000", { ...receipt, received: "1000000" }).extra).toBe(0n);
  });
  it("leaves what is still due, and nothing when no receipt exists", () => {
    expect(optionFigures("100000", { ...receipt, received: "40000" })).toMatchObject({
      extra: 0n,
      due: 60000n,
    });
    expect(optionFigures("100000", undefined)).toEqual({
      received: 0n,
      extra: 0n,
      due: 100000n,
    });
  });
});

describe("leadOption", () => {
  const usdc = { optionId: `0x${"a".repeat(64)}`, received: "5000000" };
  const ousd = { optionId: `0x${"b".repeat(64)}`, received: "10000" };
  const funded = (o: { received: string }) => BigInt(o.received) > 0n;

  it("follows the option the payment is recorded on, not a smaller deposit on another listed first", () => {
    const payment = { optionId: usdc.optionId, optionLocked: true };
    expect(leadOption(payment, [ousd, usdc], funded)).toBe(usdc);
  });

  it("takes the first option with money while none is decided", () => {
    const payment = { optionId: usdc.optionId, optionLocked: false };
    expect(leadOption(payment, [{ ...usdc, received: "0" }, ousd], funded)).toBe(ousd);
  });
});

describe("held money", () => {
  const problem = (code: string, extra: Record<string, unknown> = {}) => ({
    amount: null,
    asset: null,
    code,
    action: "review_funds",
    optionId: null,
    endpointId: null,
    eventId: null,
    reason: null,
    ...extra,
  });
  const asset = { chainId: 421614, token: `0x${"1".repeat(40)}`, symbol: "USDC", decimals: 6 };
  it("names how much is held and why, and nothing without held money", () => {
    const held = problem("held_funds", { amount: "500000", asset, reason: "late" });
    expect(heldHint([held])).toBe(PAYMENT_DETAIL_COPY.held("0.50 USDC", HELD_REASONS.late));
    expect(heldHint([problem("held_funds", { amount: "500000", asset })])).toBe(
      PAYMENT_DETAIL_COPY.held("0.50 USDC", undefined),
    );
    expect(heldHint([problem("webhook_delivery")])).toBeNull();
  });
});

describe("the balance report's status", () => {
  const settled = {
    receiverCount: 1,
    verifiedReceivers: 1,
    unreconciledReceivers: 0,
    pendingDeposits: 0,
    unbookedDeposits: 0,
    unbookedOutflows: 0,
    otherAssetMovements: 0,
    policyExceptions: 0,
    scanCurrent: true,
  } as Parameters<typeof health>[0];
  it("is verified only while the network's scan is current", () => {
    expect(health(settled).label).toBe(RECONCILIATION_COPY.verified);
    expect(health({ ...settled, scanCurrent: false }).label).toBe(RECONCILIATION_COPY.checking);
  });
});
