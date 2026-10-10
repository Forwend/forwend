import { PAYMENT_STATUS } from "@forwend/ui-web";
import { describe, expect, it } from "vitest";
import {
  AMOUNT_ERRORS,
  confirmingProgress,
  type Deposit,
  exactDigits,
  filterInvoices,
  INVOICE_PDFS,
  type Invoice,
  invalidField,
  invoiceNumber,
  invoicePdfUrl,
  invoiceProgress,
  invoiceStatus,
  parseTokenAmount,
} from "@/features/invoices/invoices";

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
  it("shows every decimal an amount has, and at least 2", () => {
    expect(exactDigits(1n, 6)).toBe(6);
    expect(exactDigits(1_234_560_000n, 6)).toBe(2);
    expect(exactDigits(1_123_000n, 6)).toBe(3);
    expect(exactDigits(5n, 0)).toBe(0);
  });

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
  number: 1,
  title: null,
  note: null,
  dueDate: null,
  issuer: null,
  senderName: null,
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
  deposits: [],
};
const deposit: Deposit = {
  txHash: `0x${"3".repeat(64)}`,
  logIndex: 0,
  amount: "5000000",
  blockNumber: 100,
  status: "detected",
  late: false,
  blocksLeft: 0,
  secondsLeft: 0,
};

describe("invoiceProgress", () => {
  it("waits for a payment, then confirms it with the slowest deposit's blocks and time left", () => {
    expect(invoiceProgress(open)).toMatchObject({ done: 0, current: "detected" });
    const confirming = {
      ...open,
      paymentStatus: "detected",
      deposits: [
        { ...deposit, blocksLeft: 4, secondsLeft: 50 },
        { ...deposit, logIndex: 1, blocksLeft: 9, secondsLeft: 110 },
      ],
    };
    expect(invoiceProgress(confirming)).toEqual({
      done: 1,
      current: "confirming",
      blocksLeft: 9,
      secondsLeft: 110,
    });
  });

  it("is paid only on the API's word, and done once settled", () => {
    const confirmed = { ...open, deposits: [{ ...deposit, status: "confirmed" }] };
    expect(invoiceProgress({ ...confirmed, paymentStatus: "partially_paid" })).toMatchObject({
      done: 2,
      current: "paid",
    });
    expect(invoiceProgress({ ...confirmed, paymentStatus: "paid" })).toMatchObject({
      done: 3,
      current: "settled",
    });
    const settled = { ...confirmed, paymentStatus: "paid", settlementStatus: "settled" };
    expect(invoiceProgress(settled)).toMatchObject({ done: 4, current: null });
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
  it("fills as blocks pass against the most seen, and claims nothing before one passes", () => {
    expect(confirmingProgress(544, 544)).toBeNull();
    expect(confirmingProgress(408, 544)).toBe(0.25);
    expect(confirmingProgress(0, 544)).toBe(1);
    expect(confirmingProgress(0, 0)).toBeNull();
  });
});

describe("filterInvoices", () => {
  const items = [
    {
      ...open,
      number: 18,
      title: "Brand site",
      client: { name: "Brightline", email: null, address: null },
    },
    { ...open, number: 7, note: "Lunch on Friday", paymentStatus: "detected" },
    { ...open, number: 3, paymentStatus: "paid", settlementStatus: "settled" },
    { ...open, number: 2, paymentStatus: "expired_partially_paid" },
  ];
  const numbers = (filter: Parameters<typeof filterInvoices>[1], search = "") =>
    filterInvoices(items, filter, search).map((inv) => inv.number);

  it("groups statuses: open covers payments on their way, expired covers partial ones", () => {
    expect(numbers("all")).toEqual([18, 7, 3, 2]);
    expect(numbers("open")).toEqual([18, 7]);
    expect(numbers("paid")).toEqual([]);
    expect(numbers("settled")).toEqual([3]);
    expect(numbers("expired")).toEqual([2]);
  });

  it("searches the number, title, note and client in any letter case", () => {
    expect(numbers("all", "inv-0018")).toEqual([18]);
    expect(numbers("all", "lunch")).toEqual([7]);
    expect(numbers("all", "BRAND")).toEqual([18]);
    expect(numbers("all", "brightline")).toEqual([18]);
    expect(numbers("open", "0007")).toEqual([7]);
    expect(numbers("settled", "0007")).toEqual([]);
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
