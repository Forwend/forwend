import { describe, expect, it } from "vitest";
import { transactionFee } from "@/features/transactions/lib/transactions";
import type { Transaction } from "@/features/transactions/types/transactions";

const sent: Transaction = {
  chainId: 5042,
  token: "0x3600000000000000000000000000000000000000",
  symbol: "USDC",
  decimals: 6,
  direction: "out",
  amount: "5000000",
  counterparty: "0x00000000000000000000000000000000000000bb",
  txHash: `0x${"a".repeat(64)}`,
  logIndex: 0,
  blockNumber: 10,
  at: "2026-11-08T10:00:00Z",
  status: "confirmed",
  usdValue: "5.000000",
  classification: "sent",
  labelable: false,
  invoice: null,
  recordsValue: null,
  feePaid: null,
};

// R-224, R-228: the Fee column and the opened row's sum read this; it is never part of the amount.
describe("transactionFee", () => {
  it("is the gas a send's wallet paid, 0 where Forwend paid, and null where none was recorded", () => {
    expect(transactionFee({ ...sent, feePaid: "3908" })).toBe(3908n);
    expect(transactionFee({ ...sent, feePaid: "0" })).toBe(0n);
    expect(transactionFee({ ...sent, feePaid: null })).toBeNull();
  });

  it("is what a settlement paid out of the payment before the rest arrived", () => {
    const payment = {
      paymentId: `0x${"b".repeat(64)}`,
      purpose: "invoice",
      documentKind: "invoice",
      policyException: null,
      unreconciled: false,
      fees: "50000",
    } as const;
    const settled: Transaction = { ...sent, direction: "in", feePaid: null, payment };
    expect(transactionFee(settled)).toBe(50000n);
    expect(transactionFee({ ...settled, payment: { ...payment, fees: null } })).toBeNull();
  });
});
