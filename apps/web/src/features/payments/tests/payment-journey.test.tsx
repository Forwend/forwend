import { TooltipProvider } from "@forwend/ui-web";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentJourney } from "@/features/payments/components/payment-journey";
import { PaymentSum } from "@/features/payments/components/payment-sum";
import {
  crossChainOf,
  paymentJourney,
  paymentMoney,
} from "@/features/payments/lib/payment-journey";
import type { PaymentDetail, PaymentOption } from "@/features/payments/types/payments";

const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BASE_TX = `0x${"9".repeat(64)}`;
const crossChain = {
  blockchain: "tron",
  symbol: "USDT",
  decimals: 6,
  amountIn: "101120000",
  status: "PROCESSING",
  deposited: "101120000",
  refunded: null,
  originTxs: [{ hash: "abc", explorerUrl: "https://tronscan.org/#/transaction/abc" }],
  destinationTxs: [],
  depositSeenAt: "2026-10-10T12:03:00Z",
  convertedAt: null,
};
const delivered = {
  ...crossChain,
  status: "SUCCESS",
  convertedAt: "2026-10-10T12:05:00Z",
  destinationTxs: [{ hash: BASE_TX, explorerUrl: "https://basescan.org/tx/0x9" }],
};
const amounts = { payable: "0", held: "0", settled: "0", fees: "0", refunded: "0" };
const deposit = (txHash: string, amount: string, change = {}) => ({
  txHash,
  logIndex: 0,
  amount,
  blockTime: "2026-10-10T12:04:00Z",
  status: "confirmed",
  late: false,
  paid: amount,
  blocksLeft: 0,
  blocksTotal: 12,
  secondsLeft: 0,
  ...change,
});
const option = (change = {}) =>
  ({
    optionId: "0xbase",
    chainId: 8453,
    token: BASE_USDC,
    symbol: "USDC",
    decimals: 6,
    amount: "1230000",
    networkFee: "60000",
    platformFee: "0",
    feesPaidBy: "owner",
    settlementStatus: "none",
    amounts,
    settlement: null,
    returns: [],
    deposits: [],
    ...change,
  }) as unknown as PaymentOption;
const payment = (change = {}) =>
  ({
    paymentId: "0xbase",
    optionId: "0xbase",
    optionLocked: false,
    optionCount: 1,
    symbol: "USDC",
    decimals: 6,
    amount: "1230000",
    paymentStatus: "open",
    settlementStatus: "none",
    closed: false,
    closesAt: "2026-10-17T12:00:00Z",
    createdAt: "2026-10-10T11:00:00Z",
    options: [option()],
    receipts: [],
    crossChain: null,
    ...change,
  }) as unknown as PaymentDetail;
const receipt = (received: string, more = {}) => [
  { optionId: "0xbase", received, pending: "0", ...more },
];
const journey = (p: PaymentDetail) => paymentJourney(p, paymentMoney(p));
const kinds = (p: PaymentDetail) => journey(p).map((s) => [s.kind, s.state]);
const sum = (p: PaymentDetail) => {
  const money = paymentMoney(p);
  return { adds: money.adds, cells: money.cells.map((c) => [c.id, c.units]) };
};

// R-248: what came in, each amount taken from it, and what the wallet gets.
describe("payment sum", () => {
  const paid = {
    paymentStatus: "paid",
    optionLocked: true,
    receipts: receipt("1230000"),
  };

  it("takes the network fee from what the customer paid, and adds up to what the wallet got", () => {
    const settled = option({
      settlementStatus: "settled",
      amounts: { ...amounts, settled: "1170000", fees: "60000" },
      deposits: [deposit(BASE_TX, "1230000")],
    });
    expect(sum(payment({ ...paid, options: [settled] }))).toEqual({
      adds: true,
      cells: [
        ["paid", 1230000n],
        ["networkFee", 60000n],
        ["wallet", 1170000n],
      ],
    });
  });

  it("draws no signs when the figures don't add up: a part payment still has money due", () => {
    const part = payment({
      optionLocked: true,
      options: [option({ deposits: [deposit(BASE_TX, "500000")] })],
      receipts: receipt("500000"),
    });
    expect(sum(part)).toEqual({
      adds: false,
      cells: [
        ["paid", 500000n],
        ["due", 730000n],
        ["networkFee", 60000n],
        ["wallet", 1170000n],
      ],
    });
  });

  it("takes money returned to the payer, and money held for them, before the fee", () => {
    const returned = option({
      amounts: { ...amounts, refunded: "270000" },
      deposits: [deposit(BASE_TX, "1500000")],
    });
    expect(sum(payment({ ...paid, options: [returned], receipts: receipt("1500000") }))).toEqual({
      adds: true,
      cells: [
        ["paid", 1500000n],
        ["returned", 270000n],
        ["networkFee", 60000n],
        ["wallet", 1170000n],
      ],
    });
    const held = option({ deposits: [deposit(BASE_TX, "1500000")] });
    expect(
      sum(payment({ ...paid, options: [held], receipts: receipt("1500000", { held: "270000" }) }))
        .cells[1],
    ).toEqual(["held", 270000n]);
  });

  it("shows the request alone before any money, and no fee or wallet figure once canceled", () => {
    expect(sum(payment({ optionCount: 2 }))).toEqual({
      adds: false,
      cells: [["requested", 1230000n]],
    });
    const canceled = payment({
      paymentStatus: "canceled",
      optionLocked: true,
      options: [option({ deposits: [deposit(BASE_TX, "500000")] })],
      receipts: receipt("500000"),
    });
    expect(sum(canceled).cells).toEqual([["paid", 500000n]]);
  });

  it("calls the money on its way only once paid in full with a transfer that is not stuck", () => {
    const settling = (settlement: object) =>
      paymentMoney(
        payment({
          ...paid,
          options: [
            option({
              amounts: { ...amounts, payable: "1230000" },
              settlement,
              deposits: [deposit(BASE_TX, "1230000")],
            }),
          ],
        }),
      ).moving;
    expect(settling({ status: "sent", wait: null })).toBe(true);
    expect(settling({ status: "refused", wait: null })).toBe(false);
    expect(settling({ status: "pending", wait: "cap" })).toBe(false);
    const part = payment({
      optionLocked: true,
      options: [option({ deposits: [deposit(BASE_TX, "500000")] })],
      receipts: receipt("500000"),
    });
    expect(paymentMoney(part).moving).toBe(false);
    // A small deposit held for the payer shows no Still due figure, and still pays nothing.
    const dust = payment({
      optionCount: 2,
      options: [option({ deposits: [deposit(BASE_TX, "50000")] })],
      receipts: receipt("50000", { held: "50000" }),
    });
    expect(paymentMoney(dust).moving).toBe(false);
  });

  it("leaves out a fee of 0", () => {
    const free = option({
      networkFee: "0",
      deposits: [deposit(BASE_TX, "1230000")],
    });
    expect(sum(payment({ ...paid, options: [free] }))).toEqual({
      adds: true,
      cells: [
        ["paid", 1230000n],
        ["wallet", 1230000n],
      ],
    });
  });
});

describe("PaymentSum", () => {
  it("says what was requested once the money that came differs, as on a part payment closed unpaid", () => {
    const closed = payment({
      closed: true,
      optionLocked: true,
      options: [option({ deposits: [deposit(BASE_TX, "500000")] })],
      receipts: receipt("500000"),
    });
    const markup = renderToStaticMarkup(
      <PaymentSum payment={closed} money={paymentMoney(closed)} />,
    );
    expect(markup).toContain("of 1.23 USDC requested");
    expect(markup).not.toContain("Still due");
  });
});

// R-239: through NEAR Intents the payment is seen on the customer's chain first, then converted into the Base option.
describe("payment journey", () => {
  it("lists the customer's transfer and Converting until the USDC reaches Base", () => {
    expect(kinds(payment({ crossChain }))).toEqual([
      ["created", "done"],
      ["origin", "done"],
      ["converting", "current"],
      ["awaiting", "upcoming"],
      ["fee", "upcoming"],
      ["wallet", "upcoming"],
    ]);
  });

  it("marks Converting done once 1Click delivered, and names its Base deposit, not an earlier one", () => {
    const earlier = `0x${"3".repeat(64)}`;
    const steps = journey(
      payment({
        crossChain: delivered,
        options: [option({ deposits: [deposit(earlier, "1"), deposit(BASE_TX, "1230000")] })],
      }),
    );
    expect(steps.find((s) => s.kind === "converting")?.state).toBe("done");
    expect(
      steps.flatMap((s) => (s.kind === "deposit" ? [[s.deposit.txHash, s.converted]] : [])),
    ).toEqual([
      [earlier, false],
      [BASE_TX, true],
    ]);
    // Still converting, a Base deposit is someone's direct one: Converting waits for 1Click.
    const direct = journey(
      payment({ crossChain, options: [option({ deposits: [deposit(BASE_TX, "1230000")] })] }),
    );
    expect(direct.find((s) => s.kind === "converting")?.state).toBe("current");
    expect(direct.some((s) => s.kind === "deposit" && s.converted)).toBe(false);
  });

  it("keeps the customer's transfer when money on another option paid first, and the sum names no other chain", () => {
    const options = [
      option(),
      option({ optionId: "0xarb", chainId: 42161, token: `0x${"a".repeat(40)}` }),
    ];
    const other = payment({
      crossChain: delivered,
      optionLocked: true,
      optionId: "0xarb",
      options,
    });
    expect(journey(other).map((s) => s.kind)).toContain("origin");
    expect(crossChainOf(other)).toBeNull();
    expect(
      crossChainOf(payment({ crossChain: delivered, optionLocked: true, options })),
    ).not.toBeNull();
  });

  it("lists deposits by time, and the customer's transfer right before the USDC it became", () => {
    const earlier = `0x${"3".repeat(64)}`;
    const steps = journey(
      payment({
        crossChain: delivered,
        options: [
          option({
            deposits: [
              deposit(BASE_TX, "1230000", { blockTime: "2026-10-10T12:05:00Z" }),
              deposit(earlier, "1", { blockTime: "2026-10-10T11:30:00Z" }),
            ],
          }),
        ],
      }),
    );
    expect(
      steps.map((s) => (s.kind === "deposit" ? s.deposit.txHash : s.kind)).slice(0, 5),
    ).toEqual(["created", earlier, "origin", "converting", BASE_TX]);
  });

  it("keeps the USDC row while 1Click's delivery is not booked, beside an earlier direct deposit", () => {
    const direct = `0x${"3".repeat(64)}`;
    const steps = journey(
      payment({
        crossChain: delivered,
        options: [option({ deposits: [deposit(direct, "500000")] })],
      }),
    );
    expect(steps.map((s) => s.kind).slice(1, 5)).toEqual([
      "deposit",
      "origin",
      "converting",
      "awaiting",
    ]);
  });

  it("makes the wallet transfer the current step while it settles, never the fee line", () => {
    const settling = option({
      amounts: { ...amounts, payable: "1230000" },
      settlement: { status: "sent", wait: null, signedAt: null, txHash: BASE_TX, blocksLeft: 9 },
      deposits: [deposit(BASE_TX, "1230000")],
    });
    expect(
      kinds(
        payment({
          paymentStatus: "paid",
          optionLocked: true,
          options: [settling],
          receipts: receipt("1230000"),
        }),
      ),
    ).toEqual([
      ["created", "done"],
      ["deposit", "done"],
      ["fee", "upcoming"],
      ["wallet", "current"],
    ]);
  });

  it("leaves the steps a direct payment's without a cross-chain payment, or for a deposit 1Click returned", () => {
    const direct = ["created", "awaiting", "fee", "wallet"];
    expect(kinds(payment()).map(([kind]) => kind)).toEqual(direct);
    for (const status of ["REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"])
      expect(
        kinds(payment({ crossChain: { ...crossChain, status } })).map(([kind]) => kind),
      ).toEqual(direct);
  });

  it("puts the paid mark on the deposit that paid it, then the fee and the wallet transfer", () => {
    const settled = option({
      settlementStatus: "settled",
      amounts: { ...amounts, settled: "1170000", fees: "60000" },
      settlement: {
        status: "confirmed",
        wait: null,
        signedAt: "2026-10-10T12:06:00Z",
        txHash: BASE_TX,
      },
      deposits: [deposit(BASE_TX, "1230000")],
    });
    const steps = journey(
      payment({
        paymentStatus: "paid",
        optionLocked: true,
        closed: true,
        options: [settled],
        receipts: receipt("1230000"),
      }),
    );
    expect(steps.map((s) => [s.kind, s.state])).toEqual([
      ["created", "done"],
      ["deposit", "done"],
      ["fee", "done"],
      ["wallet", "done"],
    ]);
    expect(steps[1]).toMatchObject({ paid: true });
  });

  it("ends a payment closed unpaid with Checkout closed, and no wallet step", () => {
    expect(kinds(payment({ closed: true })).map(([kind]) => kind)).toEqual(["created", "closed"]);
  });

  it("ends a payment the API calls expired before its closed flag says so", () => {
    const expired = payment({ state: "expired" });
    expect(kinds(expired).map(([kind]) => kind)).toEqual(["created", "closed"]);
    expect(sum(expired).cells).toEqual([["requested", 1230000n]]);
  });
});

describe("PaymentJourney", () => {
  const show = (p: PaymentDetail) =>
    renderToStaticMarkup(
      <TooltipProvider>
        <PaymentJourney payment={p} steps={journey(p)} />
      </TooltipProvider>,
    );

  it("shows what the customer sent on its own chain, the part 1Click returned and its transaction", () => {
    const markup = show(
      payment({ crossChain: { ...delivered, deposited: "101620000", refunded: "500000" } }),
    );
    expect(markup).toContain("On Tron");
    expect(markup).toContain("101.62");
    expect(markup).toContain("Returned to the customer");
    expect(markup).toContain("0.50");
    expect(markup).toContain('href="https://tronscan.org/#/transaction/abc"');
    expect(markup).toContain("Converted by");
  });

  // R-243: where 1Click gives no link, the owner gets the same known explorer as the payer.
  it("links the customer's transaction on a known explorer when 1Click gives none", () => {
    const solana =
      "4jBcpDL3KfBipWFqRBT5gVwZZoGogMBv5FWi6hi6a45CmPg6CcPJmD5Pr8jTxJGehtDrh3vmq8Tr7Q1UU6GLxoxj";
    const markup = show(
      payment({
        crossChain: {
          ...crossChain,
          blockchain: "sol",
          originTxs: [{ hash: solana, explorerUrl: "" }],
        },
      }),
    );
    expect(markup).toContain(`href="https://solscan.io/tx/${solana}"`);
  });

  // jsdom has no layout: the class is what lets a long 18-decimal amount wrap beside its title on a phone.
  it("lets a long amount wrap instead of squeezing the row", () => {
    const markup = show(
      payment({
        crossChain: {
          ...crossChain,
          decimals: 18,
          symbol: "ETH",
          blockchain: "eth",
          deposited: "1263123456789012345678",
        },
      }),
    );
    expect(markup).toMatch(/break-words[^"]*"[^>]*>(<[^>]+>)*1,/);
  });

  it("links the Base transaction 1Click delivered before the scan books it", () => {
    expect(show(payment({ crossChain: delivered }))).toContain(
      `href="https://basescan.org/tx/${BASE_TX}"`,
    );
  });

  it("shows a return to the payer with its amount, network and transaction", () => {
    const markup = show(
      payment({
        options: [
          option({
            chainId: 42431,
            symbol: "OUSD",
            returns: [
              {
                txHash: `0x${"84".repeat(32)}`,
                to: `0x${"e1".repeat(20)}`,
                amount: "900000",
                blockTime: "2026-10-31T16:02:00Z",
              },
            ],
          }),
        ],
      }),
    );
    expect(markup).toContain("Returned to the payer");
    expect(markup).toContain("0.90");
    expect(markup).toContain("On Tempo Moderato");
    expect(markup).toContain(`0x${"84".repeat(32)}`);
  });
});
