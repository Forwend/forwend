// Paying from another chain through NEAR Intents 1Click (D-123).

/** The ed25519 key 1Click signs its quotes with, as its SDK pins it (D-124). */
export const ONECLICK_KEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

/** A test build's fake 1Click key; the page takes it only when it runs on loopback itself (crossChainKey). */
export const ONECLICK_TEST_KEY = process.env.NEXT_PUBLIC_ONECLICK_TEST_KEY ?? "";

/** The one chain and token a cross-chain payment delivers: USDC on Base, as 1Click names it. */
export const CROSS_CHAIN_TARGET = {
  chainId: 8453,
  token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  decimals: 6,
  asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
} as const;

/** The slippage the api asks 1Click for, in basis points (apps/backend/internal/intents): a quote with more lets the
 * payer send more than the price needs, which then goes back to whoever the refund address is. */
export const ONECLICK_SLIPPAGE_BPS = 100;

/** No quote for a checkout closing sooner (R-231): the conversion must land before the close. */
export const CROSS_CHAIN_LEAST_MS = 20 * 60_000;

/** 1Click's statuses; SUCCESS, REFUNDED and FAILED are final. */
export const CROSS_CHAIN_STATUSES = {
  pending: "PENDING_DEPOSIT",
  knownDeposit: "KNOWN_DEPOSIT_TX",
  incomplete: "INCOMPLETE_DEPOSIT",
  processing: "PROCESSING",
  success: "SUCCESS",
  refunded: "REFUNDED",
  failed: "FAILED",
} as const;

/** 1Click's chain names for the chains payers use most; any other shows its own name in capitals. */
export const BLOCKCHAIN_NAMES: Record<string, string> = {
  eth: "Ethereum",
  base: "Base",
  arb: "Arbitrum",
  op: "Optimism",
  pol: "Polygon",
  bsc: "BNB Chain",
  avax: "Avalanche",
  gnosis: "Gnosis",
  sol: "Solana",
  tron: "Tron",
  btc: "Bitcoin",
  near: "NEAR",
  sui: "Sui",
  aptos: "Aptos",
  doge: "Dogecoin",
  ltc: "Litecoin",
  bch: "Bitcoin Cash",
  zec: "Zcash",
  cardano: "Cardano",
  starknet: "Starknet",
  bera: "Berachain",
  scroll: "Scroll",
  monad: "Monad",
  xlayer: "X Layer",
  plasma: "Plasma",
  hypercore: "Hyperliquid",
  abs: "Abstract",
};

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
