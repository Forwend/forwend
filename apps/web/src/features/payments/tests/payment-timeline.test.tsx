import { describe, expect, it } from "vitest";
import { timeline } from "@/features/payments/components/payment-detail";
import type { PaymentDetail } from "@/features/payments/types/payments";

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
  status: "PROCESSING",
  deposited: "101120000",
  delivered: null,
  refunded: null,
  refundReason: null,
  originTxs: [{ hash: "abc", explorerUrl: "https://tronscan.org/#/transaction/abc" }],
  destinationTxs: [],
  shownUntil: "2026-10-10T12:15:00Z",
  deadline: "2026-10-10T13:00:00Z",
  createdAt: "2026-10-10T12:00:00Z",
  depositSeenAt: "2026-10-10T12:03:00Z",
  convertedAt: null,
  signed: {},
};
const payment = (change: Partial<PaymentDetail>) =>
  ({
    paymentStatus: "open",
    settlementStatus: "none",
    closed: false,
    closesAt: "2026-10-17T12:00:00Z",
    createdAt: "2026-10-10T11:00:00Z",
    source: "invoice",
    optionId: "0xbase",
    options: [{ optionId: "0xbase", returns: [] }],
    crossChain,
    ...change,
  }) as unknown as PaymentDetail;
const baseDeposit = {
  deposit: { blockTime: "2026-10-10T12:04:00Z", txHash: `0x${"3".repeat(64)}`, paid: null },
  option: { chainId: 8453 },
} as never;

// R-239: through NEAR Intents the payment is seen on the customer's chain first, then converted into the Base option.
describe("payment timeline", () => {
  it("shows Detected on the customer's chain and Converting until the USDC reaches Base", () => {
    const steps = timeline(payment({}), []);
    expect(steps.map((s) => [s.id, s.state])).toEqual([
      ["created", "done"],
      ["detected", "done"],
      ["converting", "current"],
      ["paid", "upcoming"],
      ["wallet", "upcoming"],
    ]);
    expect(steps[1]?.chips?.map((c) => c.value)).toEqual([
      "Tron",
      "101.12 USDT",
      expect.anything(),
    ]);
  });

  it("marks Converting done once the USDC arrived on Base, and leaves the steps alone without a cross-chain payment", () => {
    expect(timeline(payment({}), [baseDeposit]).find((s) => s.id === "converting")?.state).toBe(
      "done",
    );
    expect(timeline(payment({ crossChain: null }), []).map((s) => s.id)).toEqual([
      "created",
      "detected",
      "paid",
      "wallet",
    ]);
  });
});
