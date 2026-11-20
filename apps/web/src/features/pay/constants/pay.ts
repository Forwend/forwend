import type { PayToken } from "@/features/pay/types/pay";

// Symbol and decimals come from this build, never the API: add a token here when the API enables it.
export const PAY_TOKENS: Readonly<Record<string, PayToken>> = {
  "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6 },
  "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831": { symbol: "USDC", decimals: 6 },
  "5042:0x3600000000000000000000000000000000000000": { symbol: "USDC", decimals: 6 },
  "4217:0x20c0000000000000000000006a37da5c996874be": { symbol: "OUSD", decimals: 6 },
  "84532:0x036cbd53842c5426634e7929541ec2318f3dcf7e": { symbol: "USDC", decimals: 6 },
  "421614:0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d": { symbol: "USDC", decimals: 6 },
  "5042002:0x3600000000000000000000000000000000000000": { symbol: "USDC", decimals: 6 },
  "42431:0x20c0000000000000000000006a37da5c996874be": { symbol: "OUSD", decimals: 6 },
};

export const PAY_STATES = {
  settled: "settled",
  paid: "paid",
  confirming: "confirming",
  checking: "checking",
  review: "review",
  partial: "partial",
  closedPartial: "closedPartial",
  closing: "closing",
  closed: "closed",
  canceled: "canceled",
  waiting: "waiting",
} as const;

/** The summary column from large screens, ending 4rem left of center; RIGHT_PAD mirrors it. */
export const LEFT_PAD = "lg:pr-16 lg:pl-[max(2.5rem,calc(50vw-30rem))]";
export const RIGHT_PAD = "lg:pr-[max(2.5rem,calc(50vw-32rem))]";

export const CLOSING_SOON_MS = 30 * 60_000;

/** A token the invoice takes, or any token through NEAR Intents. */
export const PAY_WAYS = { direct: "direct", cross: "cross" } as const;
