// @vitest-environment jsdom
import { TooltipProvider } from "@forwend/ui-web";
import { cleanup, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LatestPayments } from "@/features/payments/components/latest-payments";
import {
  CrossChainFigure,
  paidThroughIntents,
} from "@/features/payments/components/payment-detail";
import { PaymentsTable } from "@/features/payments/components/payments-table";
import type { Payment, PaymentDetail } from "@/features/payments/types/payments";
import { makeStore } from "@/store/store";

const NodeRequest = globalThis.Request;
vi.stubGlobal(
  "Request",
  class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  },
);
vi.stubGlobal("matchMedia", () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
}));

type CrossChain = NonNullable<PaymentDetail["crossChain"]>;

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
  deposited: "101620000",
  delivered: "100000000",
  refunded: "500000",
  refundReason: null,
  originTxs: [{ hash: "abc", explorerUrl: "https://tronscan.org/#/transaction/abc" }],
  destinationTxs: [{ hash: `0x${"9".repeat(64)}`, explorerUrl: "https://basescan.org/tx/0x9" }],
  shownUntil: "2026-10-10T12:15:00Z",
  deadline: "2026-10-10T13:00:00Z",
  createdAt: "2026-10-10T12:00:00Z",
  depositSeenAt: "2026-10-10T12:03:00Z",
  convertedAt: "2026-10-10T12:05:00Z",
  signed: {},
} as CrossChain;

const row = (change: Partial<Payment>) =>
  ({
    paymentId: `0x${"1".repeat(64)}`,
    optionId: `0x${"1".repeat(64)}`,
    optionLocked: false,
    optionCount: 1,
    source: "invoice",
    purpose: "invoice",
    documentKind: "invoice",
    number: 7,
    storeId: null,
    storeName: null,
    linkId: null,
    livemode: true,
    title: null,
    reference: null,
    chainId: 8453,
    token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    symbol: "USDC",
    decimals: 6,
    amount: "100000000",
    paymentStatus: "paid",
    settlementStatus: "none",
    refundStatus: "none",
    confirming: false,
    closed: false,
    createdAt: "2026-10-10T11:00:00Z",
    closesAt: "2026-10-17T11:00:00Z",
    hostedUrl: null,
    amounts: {
      receiver: "100000000",
      payable: "100000000",
      held: "0",
      settled: "0",
      refunded: "0",
      observedRefunded: "0",
      lastReturnTxHash: null,
      unreconciled: false,
    },
    crossChain: null,
    ...change,
  }) as Payment;

afterEach(cleanup);

// R-239: the owner sees how a payment through NEAR Intents was paid.
describe("cross-chain payment views", () => {
  it("tags a payment through NEAR Intents in the payments list, on wide and phone rows alike", () => {
    render(
      <TooltipProvider>
        <PaymentsTable rows={[row({ crossChain })]} />
      </TooltipProvider>,
    );
    expect(document.body.textContent?.match(/via NEAR Intents/g)).toHaveLength(2);
    cleanup();
    render(
      <TooltipProvider>
        <PaymentsTable rows={[row({})]} />
      </TooltipProvider>,
    );
    expect(document.body.textContent).not.toContain("via NEAR Intents");
  });

  it("tags it in the overview's latest payments too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ items: [row({ crossChain })], nextCursor: null })),
    );
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <LatestPayments profileId="6f9619ff-8b86-4011-b42d-00c04fc964ff" />
      </Provider>,
    );
    expect(await screen.findByText("via NEAR Intents")).toBeTruthy();
  });

  it("names what was sent, the part returned and both transactions in Details", () => {
    render(
      <dl>
        <CrossChainFigure crossChain={crossChain} chainId={8453} />
      </dl>,
    );
    expect(screen.getByText("101.62 USDT on Tron")).toBeTruthy();
    expect(screen.getByText("0.50 USDT returned to the customer's refund address")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Customer's transaction" }).getAttribute("href")).toBe(
      crossChain.originTxs[0]?.explorerUrl,
    );
    expect(screen.getByRole("link", { name: "Base transaction" }).getAttribute("href")).toBe(
      `https://basescan.org/tx/0x${"9".repeat(64)}`,
    );
  });

  it("shows no Details figure for a deposit 1Click returned", () => {
    const { container } = render(
      <CrossChainFigure crossChain={{ ...crossChain, status: "REFUNDED" }} chainId={8453} />,
    );
    expect(container.textContent).toBe("");
  });

  it("counts a deposit 1Click converts or converted, and none it returned", () => {
    expect(paidThroughIntents(crossChain)).toBe(true);
    expect(paidThroughIntents({ ...crossChain, status: "PROCESSING" })).toBe(true);
    expect(paidThroughIntents({ ...crossChain, depositSeenAt: null })).toBe(false);
    for (const status of ["REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"])
      expect(paidThroughIntents({ ...crossChain, status })).toBe(false);
  });
});
