import { ACTIVITY_DIRECTIONS, type ActivityRowProps, PAYMENT_STATUS } from "@forwend/ui-web";

// Demonstration data for the landing product panels. Always shown with a "Sample" label.
const USDC = { decimals: 6, token: "USDC" } as const;

export const SAMPLE_BALANCES = {
  available: { baseUnits: 4210500000n, ...USDC },
  incoming: { baseUnits: 1250000000n, ...USDC },
  held: { baseUnits: 25000000n, ...USDC },
} as const;

export const SAMPLE_PERSONAL_ACTIVITY: readonly (ActivityRowProps & { title: string })[] = [
  {
    title: "From Maya's Freelancer profile",
    detail: "Own-profile transfer · Base",
    direction: ACTIVITY_DIRECTIONS.incoming,
    amount: { baseUnits: 800000000n, ...USDC },
    status: PAYMENT_STATUS.settled,
  },
  {
    title: "Withdrawal to bank",
    detail: "EUR · SEPA",
    direction: ACTIVITY_DIRECTIONS.outgoing,
    amount: { baseUnits: 500000000n, ...USDC },
    status: PAYMENT_STATUS.confirming,
  },
];

export const SAMPLE_STORE_ACTIVITY: readonly (ActivityRowProps & { title: string })[] = [
  {
    title: "Order #1042",
    detail: "North Pier Coffee · Hosted checkout",
    direction: ACTIVITY_DIRECTIONS.incoming,
    amount: { baseUnits: 64500000n, ...USDC },
    status: PAYMENT_STATUS.settled,
  },
  {
    title: "Order #1043",
    detail: "North Pier Coffee · Payment link",
    direction: ACTIVITY_DIRECTIONS.incoming,
    amount: { baseUnits: 30000000n, ...USDC },
    status: PAYMENT_STATUS.partiallyPaid,
  },
  {
    title: "Order #1044",
    detail: "Pier Roasters Online · API",
    direction: ACTIVITY_DIRECTIONS.incoming,
    amount: { baseUnits: 112000000n, ...USDC },
    status: PAYMENT_STATUS.detected,
  },
];

export const SAMPLE_EVENTS = [
  { type: "invoice.detected", time: "12:04:11" },
  { type: "invoice.confirmed", time: "12:04:52" },
  { type: "invoice.settled", time: "12:05:07" },
] as const;
