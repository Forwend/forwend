// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvoiceDetail } from "@/features/invoices/components/invoice-detail";
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
  token: TOKEN.token,
  amount: "1250000000",
  recipient: "0x1111111111111111111111111111111111111111",
  receiveAddress: "0x586134f74b654f5835860ca198ae725344670078",
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
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

function serve(invoice: object) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(invoice)),
  );
}

function show(tokens: (typeof TOKEN)[] | null = [TOKEN]) {
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <ToastProvider>
        <InvoiceDetail
          invoiceId={ID}
          profileId="6f9619ff-8b86-4011-b42d-00c04fc964ff"
          tokens={tokens}
        />
      </ToastProvider>
    </Provider>,
  );
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

afterEach(cleanup);

describe("owner's invoice page", () => {
  it("does not offer the pay link, or say it waits for payment, once the checkout has closed", async () => {
    // As the API answers once nothing can complete it (R-77).
    serve({ ...OPEN, expiresAt: new Date(Date.now() - 10 * 60_000).toISOString(), closed: true });
    show();
    await settle();
    expect(screen.getByText(/Checkout closed/)).toBeTruthy();

    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.queryByText("Waiting for payment")).toBeNull();
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

  // R-124.
  it("lists the history newest first, held money in its option's token, and filters to changes", async () => {
    const dai = `0x${"ab".repeat(32)}`;
    const row = { optionId: null, amount: null, txHash: null, step: null };
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
    const history = within(screen.getByRole("region", { name: "History" }));
    // Event, By and Details of each body row; the time is the last cell.
    const rows = () =>
      within(history.getByRole("table"))
        .getAllByRole("row")
        .slice(1)
        .map((tr) => [...tr.querySelectorAll("td")].slice(0, 3).map((td) => td.textContent));
    expect(rows()).toEqual([
      ["Money held", "Forwend", "1.50 DAI for the payer · Base Sepolia"],
      ["Paid", "Forwend", "1,250.00 USDC"],
      ["Receipt email added", "Payer", "—"],
      ["Created", "You", "—"],
    ]);
    act(() => history.getByRole("radio", { name: "Changes" }).click());
    expect(rows()).toEqual([["Created", "You", "—"]]);
    act(() => history.getByRole("radio", { name: "Emails" }).click());
    expect(rows()).toEqual([["Receipt email added", "Payer", "—"]]);
  });
});
