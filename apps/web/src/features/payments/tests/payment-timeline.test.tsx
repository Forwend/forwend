import { renderToStaticMarkup } from "react-dom/server";
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
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const payment = (change: Partial<PaymentDetail>) =>
  ({
    paymentStatus: "open",
    settlementStatus: "none",
    closed: false,
    closesAt: "2026-10-17T12:00:00Z",
    createdAt: "2026-10-10T11:00:00Z",
    source: "invoice",
    optionId: "0xbase",
    options: [{ optionId: "0xbase", chainId: 8453, returns: [] }],
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

  it("marks Converting done once 1Click delivered, with its Base transaction on Paid, not an earlier deposit's", () => {
    const delivered = {
      ...crossChain,
      status: "SUCCESS",
      convertedAt: "2026-10-10T12:05:00Z",
      destinationTxs: [{ hash: `0x${"9".repeat(64)}`, explorerUrl: "https://basescan.org/tx/0x9" }],
    };
    const steps = timeline(payment({ crossChain: delivered }), [baseDeposit]);
    expect(steps.find((s) => s.id === "converting")?.state).toBe("done");
    const paid = steps.find((s) => s.id === "paid");
    expect(paid?.chips?.map((c) => c.label)).toEqual(["Network", "Tx"]);
    expect(renderToStaticMarkup(paid?.chips?.[1]?.value)).toContain("0x9999");
    // Still converting, a Base deposit is someone's direct one: Converting waits for 1Click.
    expect(timeline(payment({}), [baseDeposit]).find((s) => s.id === "converting")?.state).toBe(
      "current",
    );
  });

  it("leaves the steps a direct payment's once money on another option was recorded first", () => {
    const delivered = {
      ...crossChain,
      status: "SUCCESS",
      destinationTxs: [{ hash: `0x${"9".repeat(64)}`, explorerUrl: "https://basescan.org/tx/0x9" }],
    };
    const options = [
      { optionId: "0xbase", chainId: 8453, token: BASE_USDC, returns: [] },
      { optionId: "0xarb", chainId: 42161, token: `0x${"a".repeat(40)}`, returns: [] },
    ];
    const recorded = (optionId: string) =>
      timeline(
        payment({ crossChain: delivered, optionLocked: true, optionId, options } as never),
        [],
      )
        .map((s) => s.id)
        .includes("converting");
    expect(recorded("0xbase")).toBe(true);
    expect(recorded("0xarb")).toBe(false);
  });

  it("leaves the steps a direct payment's without a cross-chain payment, or for a deposit 1Click returned", () => {
    const direct = ["created", "detected", "paid", "wallet"];
    expect(timeline(payment({ crossChain: null }), []).map((s) => s.id)).toEqual(direct);
    for (const status of ["REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"]) {
      const steps = timeline(payment({ crossChain: { ...crossChain, status } }), [baseDeposit]);
      expect(steps.map((s) => s.id)).toEqual(direct);
      expect(steps[1]?.chips?.[0]?.label).toBe("Network");
    }
  });
});
