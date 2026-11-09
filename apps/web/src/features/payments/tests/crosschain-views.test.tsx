// @vitest-environment jsdom
import { TooltipProvider } from "@forwend/ui-web";
import { cleanup, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LatestPayments } from "@/features/payments/components/latest-payments";
import {
  CrossChainFigure,
  PaymentDetail,
  paidThroughIntents,
} from "@/features/payments/components/payment-detail";
import { PaymentsTable } from "@/features/payments/components/payments-table";
import type { PaymentDetail as Detail, Payment } from "@/features/payments/types/payments";
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

type CrossChain = NonNullable<Detail["crossChain"]>;

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

  it("shows what was sent through NEAR Intents on the payment page, and nothing for a deposit 1Click returned", async () => {
    const AT = "2026-10-10T12:05:00Z";
    const base = row({ crossChain });
    const detail = (c: CrossChain) => ({
      ...base,
      crossChain: c,
      snapshotAt: AT,
      customer: { name: null, email: null },
      metadata: {},
      problems: [],
      deliveries: [],
      deliveryCount: 0,
      deliveriesTruncated: false,
      options: [
        {
          optionId: base.optionId,
          chainId: base.chainId,
          token: base.token,
          symbol: base.symbol,
          decimals: base.decimals,
          amount: base.amount,
          receiveAddress: `0x${"c".repeat(40)}`,
          closesAt: base.closesAt,
          paymentStatus: "paid",
          settlementStatus: "none",
          refundStatus: "none",
          amounts: base.amounts,
          coverage: {
            historyComplete: true,
            verifiedBlock: 100,
            verifiedHash: null,
            verifiedTime: AT,
            observedBalance: "100000000",
            balanceDifference: "0",
            reconciliationError: null,
            bookingError: null,
            retryAt: null,
            updatedAt: AT,
            chainFinalizedBlock: 100,
            pendingDeposits: 0,
            unbookedDeposits: 0,
            unprovedDeposits: 0,
            unbookedOutflows: 0,
          },
          settlement: null,
          deposits: [],
          depositsTruncated: false,
          returns: [],
        },
      ],
    });
    const show = async (c: CrossChain) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(detail(c))),
      );
      render(
        <Provider store={makeStore({ getAccessToken: async () => "token" })}>
          <TooltipProvider>
            <PaymentDetail
              profileId="6f9619ff-8b86-4011-b42d-00c04fc964ff"
              paymentId={base.paymentId}
            />
          </TooltipProvider>
        </Provider>,
      );
      await screen.findByText("Timeline");
    };
    await show(crossChain);
    expect(screen.getByText("Sent through NEAR Intents").nextElementSibling?.textContent).toContain(
      "101.62 USDT on Tron",
    );
    cleanup();
    await show({ ...crossChain, status: "REFUNDED" });
    expect(screen.queryByText("Sent through NEAR Intents")).toBeNull();
  });

  it("names what was sent, the part returned and both transactions in Details", () => {
    render(
      <dl>
        <CrossChainFigure crossChain={crossChain} />
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

  // jsdom has no layout: the class is what lets a long 18-decimal amount wrap in a half-width card on a phone.
  it("wraps a long amount instead of clipping it", () => {
    render(
      <CrossChainFigure
        crossChain={{
          ...crossChain,
          decimals: 18,
          symbol: "ETH",
          blockchain: "eth",
          deposited: "1263123456789012345678",
        }}
      />,
    );
    expect(screen.getByText("1,263.123456789012345678 ETH on Ethereum").className).toContain(
      "break-words",
    );
  });

  it("shows no Details figure for a deposit 1Click returned", () => {
    const { container } = render(
      <CrossChainFigure crossChain={{ ...crossChain, status: "REFUNDED" }} />,
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
