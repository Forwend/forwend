import { PAYMENT_STATUS } from "@forwend/ui-web";
import { describe, expect, it } from "vitest";
import { AMOUNT_ERRORS } from "@/features/invoices/constants/invoices";
import {
  addDays,
  confirmingProgress,
  decimalText,
  dueCheckoutDate,
  invoiceException,
  invoiceProgress,
  invoiceStatus,
  isReturnLink,
  lineUnits,
  owedCents,
  parseTokenAmount,
  restartFrom,
  tokensOn,
} from "@/features/invoices/lib/invoices";
import type { Deposit, Invoice, Owed } from "@/features/invoices/types/invoices";

describe("parseTokenAmount", () => {
  it("turns typed USDC amounts into exact base units", () => {
    expect(parseTokenAmount("1", 6)).toBe(1_000_000n);
    expect(parseTokenAmount("0.000001", 6)).toBe(1n);
    expect(parseTokenAmount("1234.56", 6)).toBe(1_234_560_000n);
    expect(parseTokenAmount(" .5 ", 6)).toBe(500_000n);
    // Beyond what a float holds exactly.
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
  recipient: `0x${"4".repeat(40)}`,
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
  it("waits for a payment, then confirms it with the slowest deposit's blocks and time left", () => {
    expect(invoiceProgress(open)).toMatchObject({ done: 0, current: "waiting" });
    const confirming = {
      ...open,
      paymentStatus: "detected",
      deposits: [
        { ...deposit, blocksLeft: 4, blocksTotal: 30, secondsLeft: 50 },
        { ...deposit, logIndex: 1, blocksLeft: 9, blocksTotal: 12, secondsLeft: 110 },
      ],
    };
    expect(invoiceProgress(confirming)).toEqual({
      done: 2,
      current: "confirming",
      blocksLeft: 9,
      blocksTotal: 12,
      secondsLeft: 110,
    });
  });

  it("labels detected and partly paid invoices as confirming while finality is pending", () => {
    const partly = { ...open, paymentStatus: "partially_paid" };
    expect(invoiceStatus(partly)).toBe(PAYMENT_STATUS.partiallyPaid);
    // R-77.
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

  it("is paid only on the API's word, and done once settled", () => {
    const confirmed = { ...open, deposits: [{ ...deposit, status: "confirmed" }] };
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

describe("confirmingProgress", () => {
  it("fills as blocks pass of those to wait, and claims nothing before one passes", () => {
    expect(confirmingProgress(544, 544)).toBeNull();
    expect(confirmingProgress(408, 544)).toBe(0.25);
    expect(confirmingProgress(0, 544)).toBe(1);
    expect(confirmingProgress(0, 0)).toBeNull();
  });
});

describe("form values (R-58)", () => {
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

// R-88.
describe("lineUnits", () => {
  const line = (quantity: string, price: string) =>
    lineUnits({ description: "Design", quantity, price }, 6);
  it("multiplies a quantity with up to 2 decimals by the price, exactly", () => {
    expect(line("7.5", "0.50")).toEqual({ price: 500_000n, units: 3_750_000n });
    expect(line("1", "1250")).toEqual({ price: 1_250_000_000n, units: 1_250_000_000n });
    expect(line("3", "0")).toEqual({ price: 0n, units: 0n });
  });

  it("names what is wrong with a line", () => {
    expect(lineUnits({ description: " ", quantity: "1", price: "1" }, 6)).toBe("description");
    expect(line("0", "1")).toBe("quantity");
    expect(line("1.005", "1")).toBe("quantity");
    expect(line("1000001", "1")).toBe("quantity");
    expect(line("1", "1.0000001")).toBe("price");
    expect(line("0.5", "0.000001")).toBe("exact");
  });
});

// D-80.
describe("dueCheckoutDate", () => {
  it("is the due date plus 60 days, across month, year and leap-day boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(dueCheckoutDate("2026-11-15", "2026-10-17")).toBe("2027-01-14");
    expect(dueCheckoutDate("2027-12-31", "2027-10-17")).toBe("2028-02-29");
  });

  it("stops at 364 days from today, so the close stays within the 365 days a checkout can last", () => {
    expect(dueCheckoutDate("2027-09-01", "2026-10-17")).toBe("2027-10-16");
  });
});

describe("invoiceException", () => {
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
    // Partly paid and still open says it in the amount (Received X of Y), not again here.
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
    // R-91.
    const start = {
      payWith: "fixed",
      picked: `84532:${open.token}`,
      title: "Website",
      note: "Thanks",
      returnUrl: "https://shop.example/thanks",
      reference: "PO-4500012345",
      client: { name: "Bob Ltd", email: "bob@example.com", address: "", country: "", taxId: "" },
      reminders: false,
    };
    // R-93: the agreed price does not describe the rest.
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
    // Legacy rest links do not credit payer-held funds.
    expect(restartFrom(partly, client, true, undefined)).toEqual({
      ...start,
      agreed: null,
      amount: "5",
      items: [],
    });
  });

  // R-97.
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
    // R-91: a duplicate asks the whole amount again, so the client chooses again.
    expect(restartFrom(onTime, undefined, false, undefined)).toMatchObject({
      payWith: "any",
      amount: "5",
    });
  });

  // R-88; 1 USD per token (D-75), so the copied prices read the same either way.
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

  it("keeps payer chooses while no option took money, and leaves the client empty for a request", () => {
    const choosing = { ...open, options: [option, { ...option, optionId: `0x${"9".repeat(64)}` }] };
    expect(restartFrom(choosing, undefined, false, undefined)).toMatchObject({
      payWith: "any",
      amount: "5",
      client: { name: "", email: "", address: "", country: "", taxId: "" },
    });
  });
});

describe("owedCents (R-95)", () => {
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

// R-136: New invoice offers only the tokens on; the API refuses the rest anyway.
describe("tokensOn", () => {
  const base = { chainId: 84532, token: "0x036CBD53842c5426634e7929541eC2318f3dCF7e" };
  const arb = { chainId: 421614, token: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d" };

  it("leaves out the tokens off, whatever the letter case", () => {
    expect(tokensOn([base, arb], [{ chainId: 84532, token: base.token.toLowerCase() }])).toEqual([
      arb,
    ]);
  });

  it("keeps a token with the same contract on another chain", () => {
    expect(tokensOn([base, arb], [{ chainId: 1, token: arb.token }])).toEqual([base, arb]);
  });

  it("never restores disabled tokens when acceptance is empty", () => {
    expect(tokensOn([base], [{ chainId: 84532, token: base.token.toLowerCase() }])).toEqual([]);
  });
});
