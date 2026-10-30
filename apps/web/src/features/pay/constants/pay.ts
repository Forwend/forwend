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
  review: "review",
  partial: "partial",
  closedPartial: "closedPartial",
  closing: "closing",
  closed: "closed",
  canceled: "canceled",
  waiting: "waiting",
} as const;

/** The checkout's summary side from large screens: its content ends 4rem left of the page's center and is at most
 * 26rem wide; the pay side mirrors it. Shared by the summary column and the footer under it. */
export const LEFT_PAD = "lg:pr-16 lg:pl-[max(2.5rem,calc(50vw-30rem))]";
export const RIGHT_PAD = "lg:pr-[max(2.5rem,calc(50vw-32rem))]";

/** A part of the checkout that a payer's step puts on screen rises a little and fades in; what it replaced goes at
 * once. Tailwind's translate-y sets `translate`, so that is the property that transitions. */
export const ENTER =
  "transition-[opacity,translate] duration-[var(--fw-duration-base)] ease-out starting:translate-y-1 starting:opacity-0";
