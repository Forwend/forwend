import { describe, expect, it } from "vitest";
import { feeText, sendingRow } from "@/features/transactions/lib/transactions";

const sent = {
  ...sendingRow({
    sendId: "s",
    chainId: 5042,
    token: "0x3600000000000000000000000000000000000000",
    symbol: "USDC",
    decimals: 6,
    amount: "5000000",
    to: "0x00000000000000000000000000000000000000bb",
    toProfileId: null,
    txHash: `0x${"a".repeat(64)}`,
    createdAt: "2026-11-08T10:00:00Z",
  } as Parameters<typeof sendingRow>[0]),
  status: "confirmed",
} as const;

// R-224.
describe("feeText", () => {
  it("shows the fee a send's wallet paid to the last digit, and nothing where none was paid", () => {
    expect(feeText({ ...sent, feePaid: "3908" })).toBe("Network fee 0.003908 USDC");
    expect(feeText({ ...sent, feePaid: "1250000" })).toBe("Network fee 1.25 USDC");
    expect(feeText({ ...sent, feePaid: "0" })).toBeNull();
    expect(feeText({ ...sent, feePaid: null })).toBeNull();
  });

  // R-228: a settlement's transfer is the net; the fees it paid out of the payment show under it.
  it("shows the fees a settlement paid out of the payment, and nothing for a settlement without fees", () => {
    const settled = {
      ...sent,
      direction: "in",
      feePaid: null,
      payment: {
        paymentId: `0x${"b".repeat(64)}`,
        purpose: "invoice",
        documentKind: "invoice",
        policyException: null,
        unreconciled: false,
        fees: "50000",
      },
    } as const;
    expect(feeText(settled)).toBe("After 0.05 USDC in fees");
    expect(feeText({ ...settled, payment: { ...settled.payment, fees: null } })).toBeNull();
  });
});
