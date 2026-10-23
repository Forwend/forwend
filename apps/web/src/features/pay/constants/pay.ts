import type { PayToken } from "@/features/pay/types/pay";

// By chain and contract (docs/spikes/s5-s6-testnets.md). Symbol and decimals come from this build, never the API;
// the page refuses any other token, so add one here when the API enables it.
export const PAY_TOKENS: Readonly<Record<string, PayToken>> = {
  "84532:0x036cbd53842c5426634e7929541ec2318f3dcf7e": { symbol: "USDC", decimals: 6 },
  "421614:0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d": { symbol: "USDC", decimals: 6 },
  "5042002:0x3600000000000000000000000000000000000000": { symbol: "USDC", decimals: 6 },
  "42431:0x20c0000000000000000000006a37da5c996874be": { symbol: "OUSD", decimals: 6 },
};

/** What the status panel says, in the order the checks run. */
export const PAY_STATES = {
  settled: "settled",
  paid: "paid",
  confirming: "confirming",
  checking: "checking",
  partial: "partial",
  closedPartial: "closedPartial",
  closed: "closed",
  canceled: "canceled",
  waiting: "waiting",
} as const;
