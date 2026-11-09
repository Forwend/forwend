// Paying from another chain through NEAR Intents 1Click (D-123).

/** The ed25519 key 1Click signs its quotes with, as its SDK pins it (D-124). */
export const ONECLICK_KEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

/** A test build's fake 1Click key; the page takes it only when it runs on loopback itself (crossChainKey). */
export const ONECLICK_TEST_KEY = process.env.NEXT_PUBLIC_ONECLICK_TEST_KEY ?? "";

/** The slippage the api asks 1Click for, in basis points (apps/backend/internal/intents): a quote with more lets the
 * payer send more than the price needs, which then goes back to whoever the refund address is. */
export const ONECLICK_SLIPPAGE_BPS = 100;

/** No quote for a checkout closing sooner (R-231): the conversion must land before the close. */
export const CROSS_CHAIN_LEAST_MS = 20 * 60_000;

/** The chains listed first, in this order; the rest follow by name. */
export const POPULAR_BLOCKCHAINS = [
  "eth",
  "sol",
  "tron",
  "arb",
  "base",
  "bsc",
  "pol",
  "btc",
  "op",
  "avax",
] as const;
