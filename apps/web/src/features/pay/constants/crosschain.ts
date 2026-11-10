// Paying from another chain through NEAR Intents 1Click (D-123).

import type { BrandIconName } from "@forwend/ui-web";

/** The ed25519 key 1Click signs its quotes with, as its SDK pins it (D-124). */
export const ONECLICK_KEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

/** A test build's fake 1Click key; the page takes it only when it runs on loopback itself (crossChainKey). */
export const ONECLICK_TEST_KEY = process.env.NEXT_PUBLIC_ONECLICK_TEST_KEY ?? "";

/** The slippage the api asks 1Click for, in basis points (apps/backend/internal/intents): a quote with more lets the
 * payer send more than the price needs, which then goes back to whoever the refund address is. */
export const ONECLICK_SLIPPAGE_BPS = 100;

/** A signed quote shows only while fresh (D-124): signed within the price window, and its address takes deposits for
 * an hour more. An older one replayed could send money to an address 1Click no longer serves (intents.PriceWindow). */
export const QUOTE_PRICE_WINDOW_MS = 15 * 60_000;
export const QUOTE_ADDRESS_LEAST_MS = 60 * 60_000;

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
  "op",
  "avax",
] as const;

/** Logos for 1Click's popular chains (R-246): its list names none, so any other chain shows its first letter. */
export const BLOCKCHAIN_ICONS: Readonly<Record<string, BrandIconName>> = {
  eth: "ethereum",
  sol: "solana",
  tron: "tron",
  arb: "arbitrum",
  base: "base",
  bsc: "bnbChain",
  pol: "polygon",
  btc: "bitcoin",
  op: "optimism",
  avax: "avalanche",
  near: "near",
};

/** Logos for 1Click's tokens by symbol: those chains' own tokens, USDC and USDT (R-246). */
export const CROSS_CHAIN_TOKEN_ICONS: Readonly<Record<string, BrandIconName>> = {
  USDC: "usdc",
  USDT: "usdt",
  ETH: "ethereum",
  SOL: "solana",
  TRX: "tron",
  ARB: "arbitrum",
  BNB: "bnbChain",
  POL: "polygon",
  BTC: "bitcoin",
  OP: "optimism",
  AVAX: "avalanche",
  NEAR: "near",
};
