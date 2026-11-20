// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from "@forwend/ui-web";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvoiceDetail } from "@/features/invoices/components/invoice-detail";
import { INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import { makeStore } from "@/store/store";

vi.stubGlobal("matchMedia", () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
}));

const ID = "0x7f3a9c1e5b2d4086a1c3e5f7092b4d6f8a0c2e4f6a8b0d2f4e6c8a0b2d4f6e81";
const TOKEN = {
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
};
const OPEN = {
  invoiceId: ID,
  payToken: "cd".repeat(32),
  optionId: ID,
  optionLocked: false,
  optionCount: 1,
  confirming: false,
  closed: false,
  senderName: null,
  returnUrl: null,
  nextCheckAt: null,
  updates: [],
  replacedBy: null,
  lines: [],
  options: [
    {
      optionId: ID,
      chainId: 84532,
      network: "base-sepolia",
      token: TOKEN.token,
      symbol: "USDC",
      decimals: 6,
      amount: "1250000000",
      networkFee: "0",
      platformFee: "0",
      feesPaidBy: "owner",
      receiveAddress: "0x586134f74b654f5835860ca198ae725344670078",
      deposits: [],
    },
  ],
  number: 1,
  title: "Logo design",
  note: null,
  dueDate: null,
  supplyDate: null,
  reference: null,
  agreedValue: null,
  client: { name: "Acme", email: null, address: null, country: null, taxId: null },
  issuer: null,
  chainId: 84532,
  livemode: false,
  token: TOKEN.token,
  amount: "1250000000",
  networkFee: "0",
  platformFee: "0",
  feesPaidBy: "owner",
  purpose: "invoice",
  documentKind: "invoice",
  recipient: "0x1111111111111111111111111111111111111111",
  factory: "0xf93da73f1308a9b34aab78bf6d84f0bacc600dd2",
  receiveAddress: "0x586134f74b654f5835860ca198ae725344670078",
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  closesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  settleDeadline: new Date(Date.now() + 8 * 86_400_000).toISOString(),
  paymentStatus: "open",
  settlementStatus: "none",
  settlementTxHash: null,
  createdAt: "2026-10-10T11:00:00Z",
  paidAt: null,
  settledAt: null,
  canceledAt: null,
  deposits: [],
  settlementWait: null,
};

const DEPOSIT = {
  txHash: `0x${"3".repeat(64)}`,
  logIndex: 0,
  from: `0x${"5".repeat(40)}`,
  amount: "400000000",
  blockNumber: 100,
  blockTime: "2026-10-10T12:00:00Z",
  status: "confirmed",
  late: false,
  paid: "400000000",
  blocksLeft: 0,
  blocksTotal: 0,
  secondsLeft: 0,
};
// Closed a day ago with 400 of 1,250 USDC paid.
function closedPartly(reopenUntil: string) {
  const closedAt = new Date(Date.now() - 86_400_000).toISOString();
  return {
    ...OPEN,
    expiresAt: closedAt,
    closesAt: closedAt,
    paymentStatus: "expired_partially_paid",
    deposits: [DEPOSIT],
    options: [{ ...OPEN.options[0], deposits: [DEPOSIT] }],
    reopenUntil,
    history: [],
  };
}

// The owner's read answers current(); a POST runs posted, then answers the read.
function serveReopen(current: () => object, posted: () => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      if (request.method === "POST") posted();
      return Response.json(current());
    }),
  );
}

function serve(invoice: object) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(invoice)),
  );
}

async function show() {
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <TooltipProvider>
        <ToastProvider>
          <InvoiceDetail invoiceId={ID} profileId="6f9619ff-8b86-4011-b42d-00c04fc964ff" />
        </ToastProvider>
      </TooltipProvider>
    </Provider>,
  );
  await screen.findByRole("heading", { level: 1 });
}

afterEach(cleanup);

describe("owner's invoice page", () => {
  it("does not offer the pay link, or say it waits for payment, once the checkout has closed", async () => {
    const past = new Date(Date.now() - 10 * 60_000).toISOString();
    serve({ ...OPEN, expiresAt: past, closesAt: past, closed: true });
    await show();
    const region = (name: string) => within(screen.getByRole("region", { name }));
    expect(region("Details").getByText(/Checkout closed/)).toBeTruthy();
    expect(region("Progress").getByText("Checkout closed")).toBeTruthy();

    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.queryByText("Waiting for payment")).toBeNull();
    expect(region("Billed to").queryByText("No client email.")).toBeNull();
  });

  it("keeps the pay link, Check status, edits and cancel on an overdue invoice whose checkout is open", async () => {
    serve({ ...OPEN, dueDate: "2026-01-01" });
    await show();
    const header = within(document.body);
    expect(header.getByText("Overdue")).toBeTruthy();
    expect(header.getAllByRole("button", { name: "Copy link" }).length).toBeGreaterThan(0);
    act(() => header.getByRole("button", { name: "More actions" }).click());
    const sheet = within(screen.getByRole("dialog", { name: "INV-0001" }));
    for (const item of ["Edit", "Check status", "Cancel invoice"]) {
      expect(sheet.getByRole("button", { name: item })).toBeTruthy();
    }
    expect(sheet.getByRole("link", { name: "Revise" })).toBeTruthy();
  });
  it("sums a paid invoice's money from its deposits, less each fee, once it has moved to the wallet", async () => {
    const full = { ...DEPOSIT, amount: "1250000000", paid: "1250000000" };
    serve({
      ...OPEN,
      paymentStatus: "paid",
      settlementStatus: "settled",
      paidAt: full.blockTime,
      settledAt: "2026-10-10T12:05:00Z",
      // Settled: nothing is left in the payment address or on its way, so `payable` is 0.
      amounts: {
        receiver: "0",
        payable: "0",
        held: "0",
        settled: "1250000000",
        refunded: "0",
        observedRefunded: "0",
        lastReturnTxHash: null,
        unreconciled: false,
      },
      deposits: [full],
      options: [{ ...OPEN.options[0], networkFee: "60000", deposits: [full] }],
    });
    await show();
    const amount = within(screen.getByRole("region", { name: "In your wallet" }));
    expect(amount.getAllByRole("definition").map((dd) => dd.textContent)).toEqual([
      "1,250.00 USDC",
      "− 0.06 USDC",
      "1,249.94 USDC",
    ]);
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
  });
  it("takes money returned to the customer as Refunded, with its transaction, and holds the rest", async () => {
    const over = { ...DEPOSIT, amount: "1260000000", paid: "1250000000" };
    const returnTx = `0x${"9".repeat(64)}`;
    serve({
      ...OPEN,
      paymentStatus: "paid",
      settlementStatus: "settled",
      paidAt: over.blockTime,
      settledAt: "2026-10-10T12:05:00Z",
      deposits: [over],
      options: [
        {
          ...OPEN.options[0],
          networkFee: "60000",
          deposits: [over],
          amounts: {
            receiver: "0",
            payable: "0",
            held: "6000000",
            settled: "1249940000",
            refunded: "4000000",
            observedRefunded: "4000000",
            lastReturnTxHash: returnTx,
            unreconciled: false,
          },
        },
      ],
    });
    await show();
    const amount = within(screen.getByRole("region", { name: "In your wallet" }));
    expect(amount.getAllByRole("term").map((dt) => dt.textContent)).toEqual([
      "Customer paid",
      "Refunded",
      "Held for the customer",
      "Network fee",
      "In your wallet",
    ]);
    expect(amount.getAllByRole("definition").map((dd) => dd.textContent)).toEqual([
      "1,260.00 USDC",
      "− 4.00 USDC",
      "− 6.00 USDC",
      "− 0.06 USDC",
      "1,249.94 USDC",
    ]);
    expect(amount.getByRole("link", { name: /^View transaction on / }).title).toBe(returnTx);
    expect(screen.queryByText(/^Recorded returns:/)).toBeNull();
  });

  it("names what the client paid through NEAR Intents, and nothing for a deposit 1Click returned", async () => {
    const crossChain = {
      quoteId: "q",
      assetId: "nep141:tron-usdt",
      blockchain: "tron",
      symbol: "USDT",
      decimals: 6,
      depositAddress: "T1",
      refundTo: "T2",
      amountIn: "101120000",
      minAmountIn: "100120000",
      amountOut: "100000000",
      status: "SUCCESS",
      deposited: "101120000",
      delivered: "100000000",
      refunded: null,
      refundReason: null,
      originTxs: [],
      destinationTxs: [],
      shownUntil: "2026-10-10T12:15:00Z",
      deadline: "2026-10-10T13:00:00Z",
      createdAt: "2026-10-10T12:00:00Z",
      depositSeenAt: "2026-10-10T12:03:00Z",
      convertedAt: "2026-10-10T12:05:00Z",
      signed: {},
    };
    serve({ ...OPEN, crossChain });
    await show();
    expect(screen.getByText(INVOICE_COPY.paidThrough).nextElementSibling?.textContent).toBe(
      "101.12 USDT on Tron",
    );
    cleanup();
    serve({ ...OPEN, crossChain: { ...crossChain, status: "REFUNDED", convertedAt: null } });
    await show();
    expect(screen.queryByText(INVOICE_COPY.paidThrough)).toBeNull();
    cleanup();
    serve({ ...OPEN, optionLocked: true, crossChain });
    await show();
    expect(screen.queryByText(INVOICE_COPY.paidThrough)).toBeNull();
  });

  it("lists the items in the invoice's own option", async () => {
    const dai = "0x00000000000000000000000000000000000000da";
    const other = `0x${"ab".repeat(32)}`;
    serve({
      ...OPEN,
      optionId: other,
      optionLocked: true,
      optionCount: 2,
      token: dai,
      amount: "1250000000000000000000",
      options: [
        ...OPEN.options,
        {
          ...OPEN.options[0],
          optionId: other,
          token: dai,
          symbol: "DAI",
          decimals: 18,
          amount: "1250000000000000000000",
        },
      ],
      lines: [
        { description: "Design", quantity: "7.50", unitPrice: "100000000", amount: "750000000" },
        { description: "Hosting", quantity: "1.00", unitPrice: "500000000", amount: "500000000" },
      ],
    });
    await show();
    const items = within(screen.getByRole("region", { name: "Items" }));
    expect(items.getByText("7.5 × 100.00 USD")).toBeTruthy();
    expect(items.getByText("750.00 USD")).toBeTruthy();
    expect(items.getByText("1 × 500.00 USD")).toBeTruthy();
    expect(items.getByText("1,250.00 USD")).toBeTruthy();
  });

  it("never calls a canceled invoice's held money a part payment", async () => {
    serve({
      ...OPEN,
      paymentStatus: "canceled",
      canceledAt: "2026-10-11T09:00:00Z",
      amounts: {
        receiver: "400000000",
        payable: "0",
        held: "400000000",
        settled: "0",
        refunded: "0",
        observedRefunded: "0",
        lastReturnTxHash: null,
        unreconciled: false,
      },
    });
    await show();
    expect(screen.queryByText("Still due")).toBeNull();
    expect(screen.queryByText(/^Received /)).toBeNull();
  });

  it("keeps a return the money line can't show, as on a canceled invoice", async () => {
    serve({
      ...OPEN,
      paymentStatus: "canceled",
      canceledAt: "2026-10-11T09:00:00Z",
      options: [
        {
          ...OPEN.options[0],
          amounts: {
            receiver: "0",
            payable: "0",
            held: "0",
            settled: "0",
            refunded: "400000000",
            observedRefunded: "400000000",
            lastReturnTxHash: `0x${"9".repeat(64)}`,
            unreconciled: false,
          },
        },
      ],
    });
    await show();
    expect(screen.getByText("Recorded returns: 400.00 USDC on Base Sepolia.")).toBeTruthy();
  });
  it("reopens an invoice that closed partly paid, then shows the new close and the History row", async () => {
    const until = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const day = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(until));
    const closed = closedPartly(until);
    const reopened = {
      ...closed,
      closesAt: until,
      paymentStatus: "partially_paid",
      reopenUntil: null,
      history: [
        {
          id: 1,
          kind: "invoice.reopened",
          actor: "owner",
          at: new Date().toISOString(),
          optionId: null,
          amount: null,
          txHash: null,
          step: null,
          field: null,
          from: null,
          to: null,
          until,
          related: null,
        },
      ],
    };
    let current: object = closed;
    serveReopen(
      () => current,
      () => {
        current = reopened;
      },
    );
    await show();
    const header = within(document.body);
    const amount = within(header.getByRole("region", { name: "Not paid" }));
    expect(amount.getByText("Received 400.00 USDC of 1,250.00 USDC")).toBeTruthy();
    expect(header.getByRole("button", { name: "Reopen checkout" })).toBeTruthy();
    expect(header.getByRole("link", { name: "New invoice" })).toBeTruthy();
    expect(screen.queryByText(/is held for the payer/)).toBeNull();
    act(() => screen.getByRole("button", { name: "Reopen checkout" }).click());
    const dialog = within(screen.getByRole("dialog", { name: "Reopen INV-0001?" }));
    expect(
      dialog.getByText(`The checkout opens again until ${day}`, { exact: false }),
    ).toBeTruthy();
    await act(async () => dialog.getByRole("button", { name: "Reopen" }).click());
    expect(await screen.findByText(`INV-0001 reopened until ${day}`)).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Reopen checkout" })).toBeNull(),
    );
    const closes = screen.getByText("Checkout closes").parentElement as HTMLElement;
    expect(closes.textContent).toContain(day);
    expect(document.activeElement).toBe(closes);
    const history = within(screen.getByRole("region", { name: "Document history" }));
    const [, row] = within(history.getByRole("table")).getAllByRole("row");
    expect(
      [...(row?.querySelectorAll("td") ?? [])].slice(0, 3).map((td) => td.textContent),
    ).toEqual(["Reopened", "You", `Until ${day}`]);
  });

  it("says under the header why paid money waits, and offers Check status only while it can take money", async () => {
    const more = () => {
      act(() =>
        within(screen.getByRole("banner")).getByRole("button", { name: "More actions" }).click(),
      );
      return within(screen.getByRole("dialog", { name: "INV-0001" }));
    };
    serve(OPEN);
    await show();
    expect(more().getByRole("button", { name: "Check status" })).toBeTruthy();
    cleanup();

    serve({
      ...OPEN,
      paymentStatus: "paid",
      settlementStatus: "pending",
      paidAt: new Date().toISOString(),
      settlementWait: { kind: "finalizing", until: null, secondsLeft: 720 },
    });
    await show();
    const paid = within(document.body);
    const why = paid.getByText(
      "Sending to your wallet · waiting for Base Sepolia to finalize, about 12 min left",
    );
    expect(why.getAttribute("role")).toBe("status");
    expect(more().queryByRole("button", { name: "Check status" })).toBeNull();
  });
  it("offers New invoice in the header once the checkout closed or the invoice was canceled", async () => {
    const past = new Date(Date.now() - 10 * 60_000).toISOString();
    for (const invoice of [
      { ...OPEN, expiresAt: past, closesAt: past, closed: true },
      { ...OPEN, paymentStatus: "canceled", canceledAt: past },
    ]) {
      serve(invoice);
      await show();
      const header = within(document.body);
      const restart = header.getByRole("link", { name: "New invoice" });
      expect(restart.getAttribute("href")).toBe(`/app/invoices/new?from=${ID}`);
      for (const link of header.getAllByRole("link", { name: "View payment" })) {
        expect(link.getAttribute("href")).toBe(`/app/payments/${ID}`);
      }
      expect(screen.queryByText(/can't take money again|is held for the payer/)).toBeNull();
      cleanup();
    }
    const booking = {
      receiver: "0",
      payable: "1250000000",
      held: "0",
      settled: "0",
      refunded: "0",
      observedRefunded: "0",
      lastReturnTxHash: null,
      unreconciled: false,
      hasPolicyException: false,
      reconciliationStatus: "verified",
    };
    for (const invoice of [
      OPEN,
      {
        ...OPEN,
        paymentStatus: "canceled",
        canceledAt: past,
        replacedBy: { invoiceId: `0x${"b".repeat(64)}`, number: 2, payToken: null },
      },
      { ...OPEN, expiresAt: past, closesAt: past, closed: true, amounts: booking },
    ]) {
      serve(invoice);
      await show();
      expect(within(document.body).queryByRole("link", { name: "New invoice" })).toBeNull();
      cleanup();
    }
  });
});

it("warns about payment verification only for records in review, not ones still pending", async () => {
  const amounts = {
    receiver: "0",
    payable: "0",
    held: "0",
    settled: "0",
    refunded: "0",
    observedRefunded: "0",
    lastReturnTxHash: null,
    unreconciled: true,
    hasPolicyException: false,
  };
  const main = OPEN.options[0];
  if (!main) throw new Error("Missing option fixture");
  const closed = (status: string) => ({
    ...OPEN,
    paymentStatus: "expired",
    closed: true,
    amounts: { ...amounts, reconciliationStatus: status },
    optionCount: 4,
    options: [
      main,
      ...["1", "2", "3"].map((value) => ({ ...main, optionId: `0x${value.repeat(64)}` })),
    ].map((option) => ({ ...option, amounts: { ...amounts, reconciliationStatus: status } })),
  });
  serve(closed("pending"));
  await show();
  expect(screen.queryByRole("link", { name: "View verification details" })).toBeNull();
  cleanup();
  serve(closed("review"));
  await show();
  expect(screen.getByRole("link", { name: "View verification details" })).toBeTruthy();
});
