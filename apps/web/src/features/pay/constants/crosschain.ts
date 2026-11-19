/** The ed25519 key 1Click signs its quotes with, as its SDK pins it. */
export const ONECLICK_KEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

/** A test build's fake 1Click key, taken only on loopback (crossChainKey). */
export const ONECLICK_TEST_KEY = process.env.NEXT_PUBLIC_ONECLICK_TEST_KEY ?? "";

/** As the api asks it: more would let a payer overpay to whoever the refund address is. */
export const ONECLICK_SLIPPAGE_BPS = 100;

/** A replayed old quote could name an address 1Click no longer serves. */
export const QUOTE_PRICE_WINDOW_MS = 15 * 60_000;
export const QUOTE_ADDRESS_LEAST_MS = 60 * 60_000;

/** The conversion must land before the checkout closes. */
export const CROSS_CHAIN_LEAST_MS = 20 * 60_000;

export const POPULAR_BLOCKCHAINS = [
  "eth",
  "sol",
  "tron",
  "arb",
  "base",
  "bsc",
  "pol",
  "op",
  "avax",
] as const;
