import { describe, expect, it } from "vitest";
import type { Deposit, Invoice } from "@/features/invoices/invoices";
import { PAY_STATES, payState, payToken, receiptDeposits, shortDuration } from "@/features/pay/pay";

const invoice: Invoice = {
  invoiceId: `0x${"1".repeat(64)}`,
  number: 1,
  title: null,
  note: null,
  dueDate: null,
  issuer: null,
  senderName: null,
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  amount: "1000",
  recipient: `0x${"4".repeat(40)}`,
  receiveAddress: `0x${"2".repeat(40)}`,
  expiresAt: "2026-10-17T10:00:00Z",
  settleDeadline: "2026-10-18T10:00:00Z",
  paymentStatus: "open",
  settlementStatus: "none",
  settlementTxHash: null,
  createdAt: "2026-10-10T10:00:00Z",
  paidAt: null,
  settledAt: null,
  deposits: [],
};
const deposit = (amount: string, extra: Partial<Deposit> = {}): Deposit => ({
  txHash: `0x${"3".repeat(64)}`,
  logIndex: 0,
  from: `0x${"5".repeat(40)}`,
  amount,
  blockNumber: 100,
  blockTime: "2026-10-10T12:00:00Z",
  status: "confirmed",
  late: false,
  blocksLeft: 0,
  secondsLeft: 0,
  ...extra,
});
const before = Date.parse("2026-10-12T10:00:00Z");
const after = Date.parse("2026-10-17T10:00:00Z");

describe("payState", () => {
  it("lets the payer send only while the checkout is open and money is still owed", () => {
    expect(payState(invoice, before)).toMatchObject({ state: PAY_STATES.waiting, canSend: true });
    expect(payState(invoice, after)).toMatchObject({ state: PAY_STATES.closed, canSend: false });
    const partial = { ...invoice, paymentStatus: "partially_paid", deposits: [deposit("400")] };
    expect(payState(partial, before)).toMatchObject({
      state: PAY_STATES.partial,
      canSend: true,
      received: 400n,
      remaining: 600n,
    });
    expect(payState(partial, after)).toMatchObject({
      state: PAY_STATES.closedPartial,
      canSend: false,
    });
    const full = { ...invoice, paymentStatus: "detected", deposits: [deposit("1000")] };
    expect(payState(full, before)).toMatchObject({ state: PAY_STATES.checking, canSend: false });
  });

  it("confirms while a deposit is not final, and counts only the API as paid", () => {
    const seen = {
      ...invoice,
      paymentStatus: "detected",
      deposits: [deposit("1000", { status: "detected" })],
    };
    expect(payState(seen, before)).toMatchObject({ state: PAY_STATES.confirming, canSend: false });
    expect(payState({ ...seen, paymentStatus: "paid" }, before).state).toBe(PAY_STATES.paid);
    expect(
      payState({ ...seen, paymentStatus: "paid", settlementStatus: "settled" }, before).state,
    ).toBe(PAY_STATES.settled);
  });

  it("holds what was sent too much or too late", () => {
    const over = {
      ...invoice,
      paymentStatus: "paid",
      deposits: [deposit("1000"), deposit("250", { logIndex: 1 }), deposit("70", { late: true })],
    };
    expect(payState(over, after)).toMatchObject({ received: 1250n, extra: 250n, late: 70n });
  });
});

describe("receiptDeposits", () => {
  it("names only the confirmed payments made before the checkout closed", () => {
    const paid = deposit("1000");
    const settled = {
      ...invoice,
      paymentStatus: "paid",
      settlementStatus: "settled",
      deposits: [
        paid,
        deposit("70", { logIndex: 1, late: true }),
        deposit("5", { logIndex: 2, status: "detected" }),
      ],
    };
    expect(receiptDeposits(settled)).toEqual([paid]);
  });
});

describe("shortDuration", () => {
  it("shows the two largest units", () => {
    expect(shortDuration(((6 * 24 + 23) * 3600 + 59) * 1000)).toBe("6 d 23 h");
    expect(shortDuration(250_000)).toBe("4 min 10 s");
    expect(shortDuration(3_600_000)).toBe("1 h 0 min");
    expect(shortDuration(-5)).toBe("0 s");
  });
});

describe("payToken", () => {
  it("names OUSD on Tempo and refuses a token this build does not know", () => {
    const tempo = {
      ...invoice,
      chainId: 42431,
      token: "0x20C0000000000000000000006A37DA5C996874BE",
    };
    expect(payToken(tempo)).toEqual({ symbol: "OUSD", decimals: 6 });
    expect(payToken({ ...tempo, chainId: 84532 })).toBeNull();
  });
});
