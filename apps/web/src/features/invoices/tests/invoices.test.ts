import { PAYMENT_STATUS } from "@forwend/ui-web";
import { describe, expect, it } from "vitest";
import {
  AMOUNT_ERRORS,
  INVOICE_PDFS,
  SETTLEMENT_WAITS,
} from "@/features/invoices/constants/invoices";
import { INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import {
  confirmingProgress,
  customExpiresIn,
  decimalText,
  formatDueDate,
  formatDueDateShort,
  invalidField,
  invoiceException,
  invoiceNumber,
  invoicePdfUrl,
  invoiceProgress,
  invoiceStatus,
  isReturnLink,
  parseTokenAmount,
  restartFrom,
} from "@/features/invoices/lib/invoices";
import type { Deposit, Invoice } from "@/features/invoices/types/invoices";

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

describe("invoice display", () => {
  it("numbers invoices INV- with at least 4 digits", () => {
    expect(invoiceNumber(1)).toBe("INV-0001");
    expect(invoiceNumber(12345)).toBe("INV-12345");
  });

  it("finds the field a 422 names, and none for other reasons", () => {
    expect(
      invalidField(
        "invalid invoice request: client.email must be an email address like name@example.com",
      ),
    ).toBe("client.email");
    expect(invalidField("invalid invoice request: amount must be a decimal string")).toBe("amount");
    expect(invalidField("invalid invoice request: token is not enabled on this chain")).toBeNull();
  });
});

const open: Invoice = {
  invoiceId: `0x${"1".repeat(64)}`,
  optionId: `0x${"1".repeat(64)}`,
  optionLocked: false,
  optionCount: 1,
  confirming: false,
  closed: false,
  nextCheckAt: null,
  options: [],
  number: 1,
  title: null,
  note: null,
  dueDate: null,
  issuer: null,
  senderName: null,
  returnUrl: null,
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  amount: "5000000",
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
  blocksLeft: 0,
  blocksTotal: 0,
  secondsLeft: 0,
};

describe("formatDueDateShort", () => {
  it("drops the year only within the reader's current year", () => {
    const now = new Date(2026, 9, 15);
    expect(formatDueDateShort("2026-10-28", now)).not.toMatch(/2026/);
    expect(formatDueDateShort("2026-10-28", now)).toMatch(/28/);
    expect(formatDueDateShort("2027-01-05", now)).toBe(formatDueDate("2027-01-05"));
  });
});

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
    // The API says when the checkout closed for good (R-77); a payment still confirming keeps it confirming.
    expect(invoiceStatus({ ...partly, closed: true })).toBe(PAYMENT_STATUS.expiredPartiallyPaid);
    expect(invoiceStatus({ ...open, closed: true })).toBe(PAYMENT_STATUS.expired);
    expect(invoiceStatus({ ...partly, confirming: true })).toBe(PAYMENT_STATUS.confirming);
    expect(invoiceStatus({ ...open, paymentStatus: "detected", confirming: true })).toBe(
      PAYMENT_STATUS.confirming,
    );
    expect(invoiceStatus({ ...partly, confirming: true, settlementStatus: "settled" })).toBe(
      PAYMENT_STATUS.settled,
    );
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
    expect(invoiceStatus(settled)).toBe(PAYMENT_STATUS.settled);
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

describe("invoicePdfUrl", () => {
  it("links each PDF through the same-origin API path", () => {
    expect(invoicePdfUrl(open.invoiceId, INVOICE_PDFS.invoice)).toBe(
      `/api/v1/invoices/${open.invoiceId}/invoice.pdf`,
    );
    expect(invoicePdfUrl(open.invoiceId, INVOICE_PDFS.receipt)).toBe(
      `/api/v1/invoices/${open.invoiceId}/receipt.pdf`,
    );
  });
});

// R-54: one line per reason a paid invoice's money still waits.
describe("settlement wait line", () => {
  const line = (kind: keyof typeof SETTLEMENT_WAITS, seconds = 0, at = "") =>
    INVOICE_COPY.settling[SETTLEMENT_WAITS[kind]]("Base Sepolia", seconds, at);
  it("names the chain and the time left while the settle finalizes", () => {
    expect(line("finalizing", 720)).toBe(
      "Sending to your wallet · waiting for Base Sepolia to finalize, about 12 min left",
    );
    expect(line("finalizing", 0)).toBe(
      "Sending to your wallet · waiting for Base Sepolia to finalize, under a minute left",
    );
  });
  it("says when the signer tries again", () => {
    expect(line("retrying", 0, "14:05")).toBe("Sending to your wallet · trying again at 14:05");
    expect(line("dailyLimit", 0, "14:05")).toMatch(/used up\. Next try at 14:05$/);
  });
  it("says signing and refused without times", () => {
    expect(line("signing")).toBe("Sending to your wallet");
    expect(line("refused")).toMatch(/^Stopped for a manual check/);
  });
});

// R-55: what Check status says for each answer.
describe("check status message", () => {
  const money = (units: bigint) => `${units} units`;
  const say = (onChain: string, recorded: string, rescanning: boolean) =>
    INVOICE_COPY.recheck(
      { onChain, recorded, rescanning, nextCheckAt: "2026-10-13T12:00:30Z", unreadable: [] },
      "Base Sepolia",
      money,
    );
  it("names what is on chain but not recorded while the worker looks again", () => {
    expect(say("5000000", "1000000", true)).toBe("Found 4000000 units. Recording it now.");
    expect(say("0", "0", true)).toBe("Looking on Base Sepolia again.");
    expect(say("5000000", "0", false)).toBe("5000000 units has no recorded transfer yet.");
  });
  it("says nothing arrived, or that everything is recorded", () => {
    expect(say("0", "0", false)).toBe("Nothing on Base Sepolia yet.");
    expect(say("5000000", "5000000", false)).toBe("Up to date");
  });
});

describe("form values (R-58)", () => {
  it("writes units as the plain decimal the API reads as amountUsd", () => {
    expect(decimalText(12_500_000n, 6)).toBe("12.5");
    expect(decimalText(12_000_000n, 6)).toBe("12");
    expect(decimalText(1n, 6)).toBe("0.000001");
    expect(decimalText(1250n, 2)).toBe("12.5");
  });

  it("turns a custom date and time into seconds from now within 15 minutes to 365 days", () => {
    const now = Date.parse("2026-10-13T12:00:00");
    expect(customExpiresIn("2026-10-14", "12:00", now)).toBe(86_400);
    expect(customExpiresIn("2026-10-13", "12:15", now)).toBe(900);
    expect(customExpiresIn("2026-10-13", "12:14", now)).toBeNull();
    expect(customExpiresIn("2027-10-13", "12:00", now)).toBe(31_536_000);
    expect(customExpiresIn("2027-10-13", "12:01", now)).toBeNull();
    expect(customExpiresIn("", "12:00", now)).toBeNull();
    expect(customExpiresIn("2026-10-14", "", now)).toBeNull();
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
      left: 3_000_000n,
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
  const client = { name: "Bob Ltd", email: "bob@example.com", address: null };
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

  it("asks again for the whole amount, or only what is left, from the same client in the same token", () => {
    const partly = { ...open, options: [option], deposits: [{ ...deposit, amount: "1250000" }] };
    const start = {
      payWith: "fixed",
      picked: `84532:${open.token}`,
      client: { name: "Bob Ltd", email: "bob@example.com", address: "" },
    };
    expect(restartFrom(partly, client, false)).toEqual({ ...start, amount: "5" });
    expect(restartFrom(partly, client, true)).toEqual({ ...start, amount: "3.75" });
  });

  it("keeps payer chooses when only a late payment locked an option", () => {
    const late = { ...deposit, status: "confirmed", late: true };
    const lateLocked = {
      ...open,
      optionLocked: true,
      options: [option, { ...option, optionId: `0x${"9".repeat(64)}` }],
      deposits: [late],
    };
    expect(restartFrom(lateLocked, undefined, false).payWith).toBe("any");
    const onTime = { ...lateLocked, deposits: [{ ...late, late: false, amount: "1000000" }] };
    expect(restartFrom(onTime, undefined, true)).toMatchObject({ payWith: "fixed", amount: "4" });
  });

  it("keeps payer chooses while no option took money, and leaves the client empty for a request", () => {
    const choosing = { ...open, options: [option, { ...option, optionId: `0x${"9".repeat(64)}` }] };
    expect(restartFrom(choosing, undefined, false)).toMatchObject({
      payWith: "any",
      amount: "5",
      client: { name: "", email: "", address: "" },
    });
  });
});
