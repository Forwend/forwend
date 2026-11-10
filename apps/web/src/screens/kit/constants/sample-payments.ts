import type { PaymentDetail, PaymentOption } from "@/features/payments/types/payments";

const hash = (c: string) => `0x${c.repeat(64)}`;
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const AT = "2026-11-09T14:11:00Z";

const amounts = (change: Partial<PaymentOption["amounts"]>) => ({
  receiver: "0",
  payable: "0",
  held: "0",
  settled: "0",
  fees: "0",
  refunded: "0",
  observedRefunded: "0",
  lastReturnTxHash: null,
  unreconciled: false,
  ...change,
});

const deposit = (
  tx: string,
  amount: string,
  change: Partial<PaymentOption["deposits"][number]>,
) => ({
  txHash: hash(tx),
  logIndex: 0,
  from: `0x${"d".repeat(40)}`,
  amount,
  blockNumber: 100,
  blockTime: "2026-11-09T14:15:00Z",
  status: "confirmed",
  late: false,
  paid: amount,
  blocksLeft: 0,
  blocksTotal: 12,
  secondsLeft: 0,
  ...change,
});

const option = (change: Partial<PaymentOption>) =>
  ({
    optionId: hash("a"),
    chainId: 8453,
    token: BASE_USDC,
    symbol: "USDC",
    decimals: 6,
    amount: "1230000",
    networkFee: "60000",
    platformFee: "0",
    feesPaidBy: "owner",
    settlementStatus: "none",
    amounts: amounts({}),
    settlement: null,
    returns: [],
    deposits: [],
    ...change,
  }) as PaymentOption;

// The kit draws the page's money parts only, so a sample holds the fields those read.
const payment = (change: Partial<PaymentDetail>) =>
  ({
    paymentId: hash("a"),
    optionId: hash("a"),
    optionLocked: true,
    optionCount: 1,
    symbol: "USDC",
    decimals: 6,
    amount: "1230000",
    paymentStatus: "paid",
    settlementStatus: "settled",
    closed: true,
    createdAt: AT,
    closesAt: "2026-11-10T14:11:00Z",
    ...change,
  }) as PaymentDetail;

const settledOption = (received: string, extra: Partial<PaymentOption> = {}) =>
  option({
    settlementStatus: "settled",
    amounts: amounts({ settled: "1170000", fees: "60000" }),
    settlement: {
      status: "confirmed",
      wait: null,
      attempts: 1,
      createdAt: AT,
      nextAttemptAt: AT,
      signedAt: "2026-11-09T14:16:00Z",
      txHash: hash("5"),
    },
    deposits: [deposit("9", received, {})],
    ...extra,
  });
const receipt = (received: string, pending = "0") => [
  {
    optionId: hash("a"),
    chainId: 8453,
    token: BASE_USDC,
    symbol: "USDC",
    decimals: 6,
    received,
    pending,
  },
];

const crossChain = {
  blockchain: "arb",
  symbol: "ETH",
  decimals: 18,
  amountIn: "350000000000000",
  deposited: "350000000000000",
  refunded: null,
  status: "SUCCESS",
  originTxs: [{ hash: hash("7"), explorerUrl: `https://arbiscan.io/tx/${hash("7")}` }],
  destinationTxs: [{ hash: hash("9"), explorerUrl: `https://basescan.org/tx/${hash("9")}` }],
  depositSeenAt: "2026-11-09T14:14:00Z",
  convertedAt: "2026-11-09T14:15:00Z",
} as NonNullable<PaymentDetail["crossChain"]>;

/** Sample payments for the kit's payment page parts (R-248): sample amounts, times and transactions. */
export const SAMPLE_PAYMENTS: readonly { title: string; payment: PaymentDetail }[] = [
  {
    title: "Paid through NEAR Intents, in the wallet",
    payment: payment({
      options: [settledOption("1230000")],
      receipts: receipt("1230000"),
      crossChain: { ...crossChain, deposited: "588120000000000", refunded: "4688999911008" },
    }),
  },
  {
    title: "Still converting through NEAR Intents; a long amount",
    payment: payment({
      paymentStatus: "open",
      settlementStatus: "none",
      closed: false,
      options: [option({})],
      receipts: [],
      crossChain: {
        ...crossChain,
        status: "PROCESSING",
        deposited: "3566123456789012345678",
        destinationTxs: [],
        convertedAt: null,
      },
    }),
  },
  {
    title: "Paid directly, the transfer to the wallet confirming",
    payment: payment({
      settlementStatus: "pending",
      options: [
        option({
          amounts: amounts({ payable: "1230000" }),
          settlement: {
            status: "sent",
            wait: null,
            attempts: 1,
            createdAt: AT,
            nextAttemptAt: AT,
            signedAt: "2026-11-09T14:16:00Z",
            txHash: hash("5"),
            blocksLeft: 9,
            secondsLeft: 120,
          },
          deposits: [deposit("9", "1230000", {})],
        }),
      ],
      receipts: receipt("1230000"),
    }),
  },
  {
    title: "A deposit confirming",
    payment: payment({
      paymentStatus: "open",
      settlementStatus: "none",
      closed: false,
      confirming: true,
      options: [
        option({
          deposits: [
            deposit("9", "1230000", {
              status: "detected",
              paid: null,
              blocksLeft: 9,
              secondsLeft: 120,
            }),
          ],
        }),
      ],
      receipts: receipt("1230000", "1230000"),
    }),
  },
  {
    title: "Paid over the amount, the extra returned",
    payment: payment({
      options: [
        settledOption("1500000", {
          amounts: amounts({ settled: "1170000", fees: "60000", refunded: "270000" }),
          returns: [
            {
              txHash: hash("3"),
              to: `0x${"d".repeat(40)}`,
              amount: "270000",
              blockTime: "2026-11-09T16:02:00Z",
            },
          ],
        }),
      ],
      receipts: receipt("1500000"),
    }),
  },
  {
    title: "Nothing paid yet, the customer picks the token; a long amount",
    payment: payment({
      paymentStatus: "open",
      settlementStatus: "none",
      closed: false,
      optionLocked: false,
      optionCount: 2,
      amount: "12480250750000",
      options: [
        option({ amount: "12480250750000" }),
        option({ optionId: hash("b"), chainId: 42161, amount: "12480250750000" }),
      ],
      receipts: [],
    }),
  },
];
