// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, render, screen } from "@testing-library/react";
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
  optionId: ID,
  optionLocked: false,
  optionCount: 1,
  confirming: false,
  closed: false,
  senderName: null,
  returnUrl: null,
  nextCheckAt: null,
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
  client: { name: "Acme", email: null, address: null },
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
  // jsdom has no clipboard, like a browser that refuses it.

  it("does not offer the pay link, or say it waits for payment, once the checkout has closed", async () => {
    // As the API answers once nothing can complete it (R-77).
    serve({ ...OPEN, expiresAt: new Date(Date.now() - 10 * 60_000).toISOString(), closed: true });
    show();
    await settle();
    expect(screen.getByText(/Checkout closed/)).toBeTruthy();

    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.queryByText("Waiting for payment")).toBeNull();
  });
});
