// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from "@forwend/ui-web";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvoiceDetail } from "@/features/invoices/components/invoice-detail";
import { INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import { REFRESH_MS } from "@/shared/config/refresh";
import { makeStore } from "@/store/store";

vi.stubGlobal("matchMedia", () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
}));

const NodeRequest = globalThis.Request;
vi.stubGlobal(
  "Request",
  class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  },
);
// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.open = true;
};

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
// Closed a day ago with 400 of 1,250 USDC paid; the API says until when a reopen would run (R-130).
function closedPartly(reopenUntil: string | null) {
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

// The owner's read answers current(); a POST answers posted, or with status when it fails.
function serveReopen(current: () => object, posted: () => void, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      if (request.method !== "POST") return Response.json(current());
      posted();
      return Response.json(
        status === 200 ? current() : { error: { code: "invoice_not_reopenable" } },
        {
          status,
        },
      );
    }),
  );
}

function serve(invoice: object) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(invoice)),
  );
}

function show(tokens: (typeof TOKEN)[] | null = [TOKEN]) {
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <TooltipProvider>
        <ToastProvider>
          <InvoiceDetail
            invoiceId={ID}
            profileId="6f9619ff-8b86-4011-b42d-00c04fc964ff"
            tokens={tokens}
          />
        </ToastProvider>
      </TooltipProvider>
    </Provider>,
  );
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

afterEach(cleanup);

describe("owner's invoice page", () => {
  it("keeps the client panel's error in place, its button busy, while a retry runs", async () => {
    vi.useFakeTimers();
    let answer: () => Promise<Response> = async () => Response.json(OPEN);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => answer()),
    );
    try {
      show();
      await act(() => vi.advanceTimersByTimeAsync(30));
      answer = async () => new Response("{}", { status: 500 });
      await act(() => vi.advanceTimersByTimeAsync(REFRESH_MS));
      const client = within(screen.getByRole("region", { name: INVOICE_COPY.client }));
      const error = client.getByRole("alert");
      let release = () => {};
      answer = () => new Promise((resolve) => (release = () => resolve(Response.json(OPEN))));
      await act(() => vi.advanceTimersByTimeAsync(REFRESH_MS));
      expect(client.getByRole("alert")).toBe(error);
      expect(
        within(error).getByRole("button", { name: "Try again" }).getAttribute("aria-busy"),
      ).toBe("true");
      release();
      await act(() => vi.advanceTimersByTimeAsync(30));
      expect(client.queryByRole("alert")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps confirmation progress visible on the owner's invoice", async () => {
    const pending = {
      ...DEPOSIT,
      status: "detected",
      paid: null,
      blocksLeft: 590,
      blocksTotal: 599,
      secondsLeft: 1180,
    };
    serve({
      ...OPEN,
      paymentStatus: "detected",
      confirming: true,
      deposits: [pending],
      options: [{ ...OPEN.options[0], deposits: [pending] }],
    });
    show();
    await settle();
    const status = screen.getByRole("status", { name: "Payment confirmation" });
    expect(status.textContent).toBe("Confirming (9/599)");
    expect(within(status).getByRole("button", { name: "About 20 min left" })).toBeTruthy();
    expect(screen.queryByText("Confirming", { exact: true })).toBeNull();
  });

  it("does not offer the pay link, or say it waits for payment, once the checkout has closed", async () => {
    // As the API answers once nothing can complete it (R-77).
    const past = new Date(Date.now() - 10 * 60_000).toISOString();
    serve({ ...OPEN, expiresAt: past, closesAt: past, closed: true });
    show();
    await settle();
    const region = (name: string) => within(screen.getByRole("region", { name }));
    expect(region("Details").getByText(/Checkout closed/)).toBeTruthy();
    expect(region("Progress").getByText("Checkout closed")).toBeTruthy();

    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.queryByText("Waiting for payment")).toBeNull();
    // R-94: emailing it only sends the client a link that takes no money.
    expect(region("Billed to").queryByText("No client email.")).toBeNull();
  });

  it("keeps the pay link, Check status, edits and cancel on an overdue invoice whose checkout is open", async () => {
    serve({ ...OPEN, dueDate: "2026-01-01" });
    show();
    await settle();
    const header = within(document.body);
    expect(header.getByText("Overdue")).toBeTruthy();
    expect(header.getByText(/^\d+ days late\.$/)).toBeTruthy();
    expect(header.getByText(/^The link works until /)).toBeTruthy();
    // The pay link's actions are on the page, never the link itself.
    expect(header.getAllByRole("button", { name: "Copy link" }).length).toBeGreaterThan(0);
    expect(header.getAllByRole("link", { name: /^Open pay page/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\/pay\//)).toBeNull();
    // Phones (this test's width): More actions opens a sheet.
    act(() => header.getByRole("button", { name: "More actions" }).click());
    const sheet = within(screen.getByRole("dialog", { name: "INV-0001" }));
    for (const item of ["Edit", "Check status", "Cancel invoice"]) {
      expect(sheet.getByRole("button", { name: item })).toBeTruthy();
    }
    expect(sheet.getByRole("link", { name: "Revise" })).toBeTruthy();
    cleanup();

    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    try {
      show();
      await settle();
      // Desktop: Edit is its own button; the menu holds the rest.
      expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
      fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), { key: "Enter" });
      await settle();
      expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
        "Check status",
        "Revise",
        "Duplicate",
        "Cancel invoice",
      ]);
    } finally {
      vi.stubGlobal("matchMedia", () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      }));
    }
  });

  // R-228
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
    show();
    await settle();
    const amount = within(screen.getByRole("region", { name: "In your wallet" }));
    expect(amount.getAllByRole("definition").map((dd) => dd.textContent)).toEqual([
      "1,250.00 USDC",
      "− 0.06 USDC",
      "1,249.94 USDC",
    ]);
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
  });

  // R-228
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
    show();
    await settle();
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
    // The money line says it once; no separate line under the header.
    expect(screen.queryByText(/^Recorded returns:/)).toBeNull();
  });

  // R-239: only once 1Click delivered; money it returned didn't pay the invoice.
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
    show();
    await settle();
    expect(screen.getByText(INVOICE_COPY.paidThrough).nextElementSibling?.textContent).toBe(
      "101.12 USDT on Tron",
    );
    cleanup();
    serve({ ...OPEN, crossChain: { ...crossChain, status: "REFUNDED", convertedAt: null } });
    show();
    await settle();
    expect(screen.queryByText(INVOICE_COPY.paidThrough)).toBeNull();
    // Money on this testnet option was recorded first: 1Click's USDC on Base is held, and didn't pay it.
    cleanup();
    serve({ ...OPEN, optionLocked: true, crossChain });
    show();
    await settle();
    expect(screen.queryByText(INVOICE_COPY.paidThrough)).toBeNull();
  });

  // R-88: even once the payer locked another option.
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
    show();
    await settle();
    const items = within(screen.getByRole("region", { name: "Items" }));
    expect(items.getByText("7.5 × 100.00 USD")).toBeTruthy();
    expect(items.getByText("750.00 USD")).toBeTruthy();
    expect(items.getByText("1 × 500.00 USD")).toBeTruthy();
    expect(items.getByText("1,250.00 USD")).toBeTruthy();
  });

  // R-228
  it("adds the client's fee under the items, so they sum to the total", async () => {
    const withFee = { amount: "1250060000", networkFee: "60000", feesPaidBy: "client" };
    serve({
      ...OPEN,
      ...withFee,
      options: [{ ...OPEN.options[0], ...withFee }],
      lines: [
        { description: "Design", quantity: "1.00", unitPrice: "1250000000", amount: "1250000000" },
      ],
    });
    show();
    await settle();
    const items = within(screen.getByRole("region", { name: "Items" }));
    expect(items.getAllByRole("term").map((dt) => dt.textContent)).toEqual([
      "Subtotal",
      "Network fee",
      "Total",
    ]);
    expect(items.getByText("1,250.06 USDC")).toBeTruthy();
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
    show();
    await settle();
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
    show();
    await settle();
    expect(screen.getByText("Recorded returns: 400.00 USDC on Base Sepolia.")).toBeTruthy();
  });

  // R-124.
  it("keeps document changes and emails separate from payment transactions", async () => {
    const dai = `0x${"ab".repeat(32)}`;
    const row = {
      optionId: null,
      amount: null,
      txHash: null,
      step: null,
      field: null,
      from: null,
      to: null,
      until: null,
      related: null,
    };
    serve({
      ...OPEN,
      optionCount: 2,
      options: [
        ...OPEN.options,
        { ...OPEN.options[0], optionId: dai, symbol: "DAI", decimals: 18 },
      ],
      history: [
        {
          ...row,
          id: 3,
          kind: "invoice.held",
          actor: "system",
          at: "2026-10-12T09:00:00Z",
          optionId: dai,
          amount: "1500000000000000000",
        },
        { ...row, id: 2, kind: "invoice.paid", actor: "system", at: "2026-10-11T09:00:00Z" },
        { ...row, id: 4, kind: "payer.email_given", actor: "payer", at: "2026-10-10T12:00:00Z" },
        { ...row, id: 1, kind: "invoice.created", actor: "owner", at: "2026-10-10T11:00:00Z" },
      ],
    });
    show();
    await settle();
    const history = within(screen.getByRole("region", { name: "Document history" }));
    // Event, By and Details of each body row; the time is the last cell.
    const rows = () =>
      within(history.getByRole("table"))
        .getAllByRole("row")
        .slice(1)
        .map((tr) => [...tr.querySelectorAll("td")].slice(0, 3).map((td) => td.textContent));
    expect(rows()).toEqual([
      ["Receipt email added", "Payer", "—"],
      ["Created", "You", "—"],
    ]);
    act(() => history.getByRole("radio", { name: "Changes" }).click());
    expect(rows()).toEqual([["Created", "You", "—"]]);
    act(() => history.getByRole("radio", { name: "Emails" }).click());
    expect(rows()).toEqual([["Receipt email added", "Payer", "—"]]);
  });

  // R-130.
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
    show();
    await settle();
    // R-77: the next steps sit with the header's actions, with no box under the title.
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
    await settle();

    expect(screen.getByText(`INV-0001 reopened until ${day}`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen checkout" })).toBeNull();
    const closes = screen.getByText("Checkout closes").parentElement as HTMLElement;
    expect(closes.textContent).toContain(day);
    expect(document.activeElement).toBe(closes);
    const history = within(screen.getByRole("region", { name: "Document history" }));
    const [, row] = within(history.getByRole("table")).getAllByRole("row");
    expect(
      [...(row?.querySelectorAll("td") ?? [])].slice(0, 3).map((td) => td.textContent),
    ).toEqual(["Reopened", "You", `Until ${day}`]);
  });

  // R-54, R-55
  it("says under the header why paid money waits, and offers Check status only while it can take money", async () => {
    const more = () => {
      act(() =>
        within(screen.getByRole("banner")).getByRole("button", { name: "More actions" }).click(),
      );
      return within(screen.getByRole("dialog", { name: "INV-0001" }));
    };
    serve(OPEN);
    show();
    await settle();
    expect(more().getByRole("button", { name: "Check status" })).toBeTruthy();
    cleanup();

    serve({
      ...OPEN,
      paymentStatus: "paid",
      settlementStatus: "pending",
      paidAt: new Date().toISOString(),
      settlementWait: { kind: "finalizing", until: null, secondsLeft: 720 },
    });
    show();
    await settle();
    const paid = within(document.body);
    const why = paid.getByText(
      "Sending to your wallet · waiting for Base Sepolia to finalize, about 12 min left",
    );
    expect(why.getAttribute("role")).toBe("status");
    expect(more().queryByRole("button", { name: "Check status" })).toBeNull();
  });

  // R-77
  it("offers New invoice in the header once the checkout closed or the invoice was canceled", async () => {
    const past = new Date(Date.now() - 10 * 60_000).toISOString();
    for (const invoice of [
      { ...OPEN, expiresAt: past, closesAt: past, closed: true },
      { ...OPEN, paymentStatus: "canceled", canceledAt: past },
    ]) {
      serve(invoice);
      show();
      await settle();
      const header = within(document.body);
      const restart = header.getByRole("link", { name: "New invoice" });
      expect(restart.getAttribute("href")).toBe(`/app/invoices/new?from=${ID}`);
      // One for each width: under the next step on desktop, a row of the panel on phones.
      for (const link of header.getAllByRole("link", { name: "View payment" })) {
        expect(link.getAttribute("href")).toBe(`/app/payments/${ID}`);
      }
      expect(screen.queryByText(/can't take money again|is held for the payer/)).toBeNull();
      cleanup();
    }
    // Open, already revised, or money still being booked: no New invoice yet.
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
      show();
      await settle();
      expect(within(document.body).queryByRole("link", { name: "New invoice" })).toBeNull();
      cleanup();
    }
  });

  // R-130: the reopen window ended, or another tab reopened it, after the page loaded.
  it("says it can't reopen anymore when the API refuses", async () => {
    let current: object = closedPartly(new Date(Date.now() + 86_400_000).toISOString());
    serveReopen(
      () => current,
      () => {
        current = closedPartly(null);
      },
      409,
    );
    show();
    await settle();
    act(() => screen.getByRole("button", { name: "Reopen checkout" }).click());
    const dialog = within(screen.getByRole("dialog", { name: "Reopen INV-0001?" }));
    await act(async () => dialog.getByRole("button", { name: "Reopen" }).click());
    await settle();

    expect(screen.getByText("It can't be reopened anymore.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen checkout" })).toBeNull();
  });
});

it("does not turn unused historical options into a merchant warning", async () => {
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
    reconciliationStatus: "pending",
  };
  const main = OPEN.options[0];
  if (!main) throw new Error("Missing option fixture");
  serve({
    ...OPEN,
    paymentStatus: "expired",
    closed: true,
    amounts,
    optionCount: 4,
    options: [
      main,
      ...["1", "2", "3"].map((value) => ({ ...main, optionId: `0x${value.repeat(64)}` })),
    ].map((option) => ({ ...option, amounts })),
  });
  show();
  await settle();
  expect(screen.queryByText("Payment records need review.")).toBeNull();
  expect(screen.queryByText(/Verifying payment history/)).toBeNull();
  expect(screen.queryByRole("link", { name: "View verification details" })).toBeNull();
});
