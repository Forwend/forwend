/** What a customer sends for the example invoice. Samples, not quotes: the real pay page shows 1Click's price. */
export const ROUTE_TOKENS = [
  {
    symbol: "ETH",
    blockchain: "arb",
    baseUnits: 360800000000000000n,
    decimals: 18,
    fractionDigits: 5,
  },
  { symbol: "USDT", blockchain: "tron", baseUnits: 1265640000n, decimals: 6, fractionDigits: 2 },
  { symbol: "SOL", blockchain: "sol", baseUnits: 7856200000n, decimals: 9, fractionDigits: 4 },
] as const;

/** The route's phases: waiting, the token on its way, converting, USDC on its way, paid. */
export const ROUTE_PHASES = {
  waiting: 0,
  sent: 1,
  converting: 2,
  confirming: 3,
  paid: 4,
} as const;

/** When each phase after waiting starts, in ms from the start of one token's run, and when the run ends. */
export const ROUTE_TIMES = [900, 2300, 3700, 4900] as const;
export const ROUTE_CYCLE_MS = 7800;
/** How long the received amount counts up once the payment is paid. */
export const ROUTE_COUNT_MS = 900;
export const ROUTE_TICK_MS = 50;

export const ROUTE_STEPS = [
  {
    title: "The customer picks a token",
    from: ROUTE_PHASES.waiting,
    done: ROUTE_PHASES.sent,
  },
  {
    title: "NEAR Intents converts it",
    from: ROUTE_PHASES.sent,
    done: ROUTE_PHASES.confirming,
  },
  {
    title: "You receive USDC on Base",
    from: ROUTE_PHASES.confirming,
    done: ROUTE_PHASES.paid,
  },
] as const;
