import { PAYMENT_STATUS } from "@forwend/ui-web";
import { describe, expect, it } from "vitest";
import {
  canStillBePaid,
  decimalText,
  invoiceException,
  invoiceProgress,
  invoiceStatus,
  isReturnLink,
  owedCents,
  restartFrom,
} from "@/features/invoices/lib/invoices";
import {
  invoiceHistoryEventSchema,
  invoiceSummarySchema,
} from "@/features/invoices/schemas/invoices";
import type { Deposit, Invoice, Owed } from "@/features/invoices/types/invoices";
import { AMOUNT_ERRORS } from "@/shared/constants/money";
import { parseTokenAmount } from "@/shared/lib/money";

describe("parseTokenAmount", () => {
  it("turns typed USDC amounts into exact base units", () => {
    expect(parseTokenAmount("1", 6)).toBe(1_000_000n);
    expect(parseTokenAmount("0.000001", 6)).toBe(1n);
    expect(parseTokenAmount("1234.56", 6)).toBe(1_234_560_000n);
    expect(parseTokenAmount(" .5 ", 6)).toBe(500_000n);
    expect(parseTokenAmount("123456789012345678901.123456", 6)).toBe(123456789012345678901123456n);
  });

  it("refuses more decimals than the token has, zero, negatives and anything else", () => {
    expect(parseTokenAmount("0.0000001", 6)).toBe(AMOUNT_ERRORS.decimals);
    expect(parseTokenAmount("1.1234567", 6)).toBe(AMOUNT_ERRORS.decimals);
    expect(parseTokenAmount("0", 6)).toBe(AMOUNT_ERRORS.zero);
    expect(parseTokenAmount("0.000000", 6)).toBe(AMOUNT_ERRORS.zero);
    for (const junk of ["", ".", "-1", "1,5", "1.2.3", "1e6", "abc", "12 50", "１"]) {
      expect(parseTokenAmount(junk, 6)).toBe(AMOUNT_ERRORS.format);
    }
  });
});

const open: Invoice = {
  invoiceId: `0x${"1".repeat(64)}`,
  payToken: "2".repeat(64),
  optionId: `0x${"1".repeat(64)}`,
  optionLocked: false,
  optionCount: 1,
  confirming: false,
  closed: false,
  nextCheckAt: null,
  updates: [],
  replacedBy: null,
  lines: [],
  options: [],
  number: 1,
  title: null,
  note: null,
  dueDate: null,
  supplyDate: null,
  reference: null,
  agreedValue: null,
  issuer: null,
  senderName: null,
  returnUrl: null,
  chainId: 84532,
  livemode: false,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  amount: "5000000",
  networkFee: "0",
  platformFee: "0",
  feesPaidBy: "owner",
  purpose: "invoice",
  documentKind: "invoice",
  recipient: `0x${"4".repeat(40)}`,
  factory: `0x${"6".repeat(40)}`,
  receiveAddress: `0x${"2".repeat(40)}`,
  expiresAt: "2026-10-17T10:00:00Z",
  closesAt: "2026-10-17T10:00:00Z",
  settleDeadline: "2026-10-18T10:00:00Z",
  paymentStatus: "open",
  settlementStatus: "none",
  settlementTxHash: null,
  createdAt: "2026-10-10T10:00:00Z",
  paidAt: null,
  settledAt: null,
  canceledAt: null,
  deposits: [],
};
const deposit: Deposit = {
  txHash: `0x${"3".repeat(64)}`,
  logIndex: 0,
  from: `0x${"5".repeat(40)}`,
  amount: "5000000",
  blockNumber: 100,
  blockTime: "2026-10-10T12:00:00Z",
  status: "detected",
  late: false,
  paid: null,
  blocksLeft: 0,
  blocksTotal: 0,
  secondsLeft: 0,
};

describe("invoiceProgress", () => {
  it("labels detected and partly paid invoices as confirming while finality is pending", () => {
    const partly = { ...open, paymentStatus: "partially_paid" };
    expect(invoiceStatus(partly)).toBe(PAYMENT_STATUS.partiallyPaid);
    expect(invoiceStatus({ ...partly, closed: true })).toBe(PAYMENT_STATUS.expiredPartiallyPaid);
    expect(invoiceStatus({ ...open, closed: true })).toBe(PAYMENT_STATUS.expired);
    expect(invoiceStatus({ ...partly, confirming: true })).toBe(PAYMENT_STATUS.confirming);
    expect(invoiceStatus({ ...open, paymentStatus: "detected", confirming: true })).toBe(
      PAYMENT_STATUS.confirming,
    );
    expect(
      invoiceStatus({ ...partly, closed: true, confirming: false, settlementStatus: "settled" }),
    ).toBe(PAYMENT_STATUS.expiredPartiallyPaid);
    expect(invoiceStatus({ ...open, paymentStatus: "paid", confirming: true })).toBe(
      PAYMENT_STATUS.paid,
    );
  });

  it("reads the owner's state, the one the list filters by", () => {
    expect(invoiceStatus({ ...open, paymentStatus: "paid", state: "overpaid" })).toBe(
      PAYMENT_STATUS.overpaid,
    );
    expect(invoiceStatus({ ...open, paymentStatus: "canceled", state: "expired" })).toBe(
      PAYMENT_STATUS.expired,
    );
    expect(
      invoiceStatus({ ...open, paymentStatus: "partially_paid", closed: true, state: "expired" }),
    ).toBe(PAYMENT_STATUS.expiredPartiallyPaid);
  });

  it("keeps confirming a deposit that is final on chain until the ledger books it", () => {
    const unbooked = {
      ...open,
      deposits: [{ ...deposit, status: "confirmed", blocksLeft: 0, blocksTotal: 12 }],
    };
    expect(invoiceProgress(unbooked)).toEqual({
      done: 2,
      current: "confirming",
      blocksLeft: 0,
      blocksTotal: 0,
      secondsLeft: 0,
    });
  });

  it("is paid only on the API's word, and done once settled", () => {
    const confirmed = { ...open, deposits: [{ ...deposit, status: "confirmed", paid: "5000000" }] };
    expect(invoiceProgress({ ...confirmed, paymentStatus: "partially_paid" })).toMatchObject({
      done: 3,
      current: "paid",
    });
    expect(invoiceProgress({ ...confirmed, paymentStatus: "paid" })).toMatchObject({
      done: 4,
      current: "settled",
    });
    const settled = { ...confirmed, paymentStatus: "paid", settlementStatus: "settled" };
    expect(invoiceProgress(settled)).toMatchObject({ done: 5, current: null });
    expect(invoiceStatus(settled)).toBe(PAYMENT_STATUS.paid);
  });

  it("stops at expiry, and a late payment moves nothing", () => {
    const expired = {
      ...open,
      paymentStatus: "expired",
      deposits: [{ ...deposit, status: "confirmed", late: true }],
    };
    expect(invoiceProgress(expired)).toMatchObject({ done: 0, current: null });
    expect(invoiceStatus(expired)).toBe(PAYMENT_STATUS.expired);
  });
});

describe("invoiceSummarySchema", () => {
  it("refuses an answer without the fees, purpose or document kind the API always sends", () => {
    expect(invoiceSummarySchema.safeParse(open).success).toBe(true);
    for (const field of [
      "networkFee",
      "platformFee",
      "feesPaidBy",
      "purpose",
      "documentKind",
    ] as const) {
      const { [field]: _, ...without } = open;
      expect(invoiceSummarySchema.safeParse(without).success, field).toBe(false);
    }
  });
});

describe("invoiceHistoryEventSchema", () => {
  const row = {
    id: 2,
    kind: "invoice.return_queued",
    actor: "system",
    at: "2026-11-10T18:04:00Z",
    optionId: null,
    amount: "50000",
    txHash: `0x${"7".repeat(64)}`,
    step: null,
    field: null,
    from: null,
    to: null,
    until: null,
    related: null,
  };

  it("reads a queued return, whose to is the address the money goes back to", () => {
    const queued = { ...row, to: `0x${"a".repeat(40)}` };
    expect(invoiceHistoryEventSchema.safeParse(queued).success).toBe(true);
    const moved = {
      ...row,
      kind: "invoice.updated",
      field: "dueDate",
      from: "2026-11-20",
      to: "2026-11-27",
    };
    expect(invoiceHistoryEventSchema.safeParse(moved).success).toBe(true);
    expect(invoiceHistoryEventSchema.safeParse({ ...row, to: "soon" }).success).toBe(false);
  });
});

describe("form values", () => {
  it("writes units as the plain decimal the API reads as amountUsd", () => {
    expect(decimalText(12_500_000n, 6)).toBe("12.5");
    expect(decimalText(12_000_000n, 6)).toBe("12");
    expect(decimalText(1n, 6)).toBe("0.000001");
    expect(decimalText(1250n, 2)).toBe("12.5");
  });

  it("takes only https return links with a host and no user or password", () => {
    expect(isReturnLink("https://shop.example/thanks?order=7")).toBe(true);
    for (const bad of [
      "http://shop.example",
      "shop.example",
      "javascript:alert(1)",
      "https://user:pass@shop.example",
      "https://",
    ])
      expect(isReturnLink(bad), bad).toBe(false);
  });
});

describe("invoiceException", () => {
  it("keeps full totals when deposit history is a preview", () => {
    const preview = {
      ...open,
      deposits: [],
      depositSummary: {
        count: 200,
        onTimeAmount: "2000000",
        lateAmount: "500000",
        pendingAmount: "0",
      },
    };
    expect(invoiceException(preview, PAYMENT_STATUS.expiredPartiallyPaid)).toMatchObject({
      received: 2_000_000n,
      left: 5_000_000n,
      late: 500_000n,
    });
  });

  const paid = (amount: string, late = false) => ({
    ...deposit,
    status: "confirmed",
    amount,
    late,
  });

  it("names the next step of a closed checkout and the amounts of the shown option", () => {
    const partly = { ...open, deposits: [paid("2000000")] };
    expect(invoiceException(partly, PAYMENT_STATUS.expiredPartiallyPaid)).toEqual({
      kind: "closedPartial",
      received: 2_000_000n,
      left: 5_000_000n,
      late: 0n,
    });
    expect(invoiceException(partly, PAYMENT_STATUS.partiallyPaid).kind).toBeNull();
    expect(invoiceException(open, PAYMENT_STATUS.expired).kind).toBe("closedUnpaid");
    expect(invoiceException(partly, PAYMENT_STATUS.expiredPartiallyPaid).kind).toBe(
      "closedPartial",
    );
    expect(invoiceException(open, PAYMENT_STATUS.open).kind).toBeNull();
  });

  it("counts money after the checkout closed as late, whatever the status", () => {
    const late = { ...open, deposits: [paid("5000000"), paid("1500000", true)] };
    expect(invoiceException(late, PAYMENT_STATUS.paid)).toEqual({
      kind: null,
      received: 5_000_000n,
      left: 0n,
      late: 1_500_000n,
    });
  });
});

describe("restartFrom", () => {
  const client = {
    name: "Bob Ltd",
    email: "bob@example.com",
    address: null,
    country: null,
    taxId: null,
  };
  const option = {
    optionId: open.optionId,
    chainId: open.chainId,
    network: "base-sepolia",
    token: open.token,
    symbol: "USDC",
    decimals: 6,
    amount: open.amount,
    networkFee: "0",
    platformFee: "0",
    feesPaidBy: "owner" as const,
    receiveAddress: open.receiveAddress,
    deposits: [],
  };

  it("keeps payer-held funds separate when copying an expired bill for the same client", () => {
    const partly = {
      ...open,
      title: "Website",
      note: "Thanks",
      returnUrl: "https://shop.example/thanks",
      reference: "PO-4500012345",
      agreedValue: { currency: "EUR", amount: "460", decimals: 2, date: "2026-10-01" },
      lines: [
        { description: "Design", quantity: "7.50", unitPrice: "500000", amount: "3750000" },
        { description: "Hosting", quantity: "1.00", unitPrice: "1250000", amount: "1250000" },
      ],
      options: [option],
      deposits: [{ ...deposit, amount: "1250000" }],
    };
    const start = {
      payWith: "fixed",
      picked: `84532:${open.token}`,
      title: "Website",
      note: "Thanks",
      returnUrl: "https://shop.example/thanks",
      reference: "PO-4500012345",
      client: { name: "Bob Ltd", email: "bob@example.com", address: "", country: "", taxId: "" },
      reminders: false,
      feesPaidBy: "owner",
    };
    const agreed = { currency: "EUR", amount: "4.6", date: "2026-10-01" };
    expect(restartFrom(partly, client, false, undefined)).toEqual({
      ...start,
      agreed,
      amount: "5",
      items: [
        { id: "0", description: "Design", quantity: "7.5", price: "0.5" },
        { id: "1", description: "Hosting", quantity: "1", price: "1.25" },
      ],
    });
    expect(restartFrom(partly, client, true, undefined)).toEqual({
      ...start,
      agreed: null,
      amount: "5",
      items: [],
    });
  });

  it("copies the price of an invoice whose client paid the fees, and who pays them", () => {
    const onTop = {
      ...open,
      amount: "5050000",
      networkFee: "50000",
      platformFee: "0",
      feesPaidBy: "client" as const,
      options: [option],
    };
    const copy = restartFrom(onTop, undefined, false, undefined);
    expect(copy.amount).toBe("5");
    expect(copy.feesPaidBy).toBe("client");
  });
  it("copies reminders that are on and not stopped, only to a duplicate", () => {
    const on = { on: true, stoppedAt: null, emails: [] };
    expect(restartFrom(open, undefined, false, on).reminders).toBe(true);
    expect(restartFrom(open, undefined, true, on).reminders).toBe(false);
    expect(
      restartFrom(open, undefined, false, { ...on, stoppedAt: "2026-10-18T00:00:00Z" }).reminders,
    ).toBe(false);
    expect(restartFrom(open, undefined, false, { ...on, on: false }).reminders).toBe(false);
  });

  it("keeps payer chooses when only a late payment locked an option", () => {
    const late = { ...deposit, status: "confirmed", late: true };
    const lateLocked = {
      ...open,
      optionLocked: true,
      options: [option, { ...option, optionId: `0x${"9".repeat(64)}` }],
      deposits: [late],
    };
    expect(restartFrom(lateLocked, undefined, false, undefined).payWith).toBe("any");
    const onTime = { ...lateLocked, deposits: [{ ...late, late: false, amount: "1000000" }] };
    expect(restartFrom(onTime, undefined, true, undefined)).toMatchObject({
      payWith: "fixed",
      amount: "5",
    });
    expect(restartFrom(onTime, undefined, false, undefined)).toMatchObject({
      payWith: "any",
      amount: "5",
    });
  });

  it("copies items in the invoice's own option's decimals when the client locked another", () => {
    const dai = {
      ...option,
      optionId: `0x${"9".repeat(64)}`,
      decimals: 18,
      amount: "5000000000000000000",
    };
    const locked = {
      ...open,
      optionId: dai.optionId,
      optionLocked: true,
      amount: dai.amount,
      options: [option, dai],
      lines: [{ description: "Design", quantity: "2.00", unitPrice: "2500000", amount: "5000000" }],
    };
    expect(restartFrom(locked, undefined, false, undefined)).toMatchObject({
      payWith: "any",
      amount: "5",
      items: [{ description: "Design", quantity: "2", price: "2.5" }],
    });
  });
});

describe("owedCents", () => {
  const row = (kind: string, amount: string, decimals: number): Owed => ({
    kind,
    invoiceId: `0x${"ab".repeat(32)}`,
    number: 1,
    title: null,
    clientName: null,
    dueDate: null,
    daysLate: 0,
    optionCount: 1,
    chainId: 84532,
    token: `0x${"11".repeat(20)}`,
    symbol: "USDC",
    decimals,
    amount,
  });

  it("adds what is left at 1 USD per stablecoin across decimals, cut once to cents, without held money", () => {
    const rows = [
      row("overdue", "1234567", 6), // 1.234567
      row("partlyPaid", "1000000000000000005", 18), // 1.000000000000000005
      row("held", "9000000", 6),
    ];
    expect(owedCents(rows)).toBe(223n);
    expect(owedCents([row("held", "9000000", 6)])).toBe(0n);
    expect(owedCents([])).toBe(0n);
  });
});

it("offers the pay link only while the invoice can be paid and its checkout is open", () => {
  const now = new Date("2026-11-09T14:10:00Z");
  const open = { closesAt: "2027-01-19T14:10:00Z" };
  expect(canStillBePaid(open, PAYMENT_STATUS.overdue, now)).toBe(true);
  expect(canStillBePaid(open, PAYMENT_STATUS.partiallyPaid, now)).toBe(true);
  expect(canStillBePaid(open, PAYMENT_STATUS.paid, now)).toBe(false);
  expect(canStillBePaid(open, PAYMENT_STATUS.expired, now)).toBe(false);
  expect(canStillBePaid({ closesAt: "2026-11-09T14:00:00Z" }, PAYMENT_STATUS.confirming, now)).toBe(
    false,
  );
});
