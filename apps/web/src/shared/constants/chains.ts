import type { BrandIconName } from "@forwend/ui-web";

/** A block explorer: its name for link labels and its base URL; transactions are at /tx/<hash>. */
interface Explorer {
  name: string;
  url: string;
}

/** The chains the API may return (packages/contracts/chains.json): mainnets in live mode, testnets in test mode.
 * Explorers come from each network's docs; a local chain has none. */
export const CHAINS: Readonly<
  Record<
    number,
    {
      name: string;
      icon?: BrandIconName;
      explorer?: Explorer;
      // A bridged token that looks like the real one by name, which the receive address does not count (R-78).
      lookalikes?: Readonly<Record<string, string>>;
    }
  >
> = {
  8453: {
    name: "Base",
    icon: "base",
    explorer: { name: "Basescan", url: "https://basescan.org" },
  },
  42161: {
    name: "Arbitrum",
    icon: "arbitrum",
    explorer: { name: "Arbiscan", url: "https://arbiscan.io" },
    lookalikes: { USDC: "USDC.e" },
  },
  5042: {
    name: "Arc",
    icon: "arc",
    explorer: { name: "Arc Explorer", url: "https://explorer.arc.io" },
  },
  4217: {
    name: "Tempo",
    icon: "tempo",
    explorer: { name: "Tempo Explorer", url: "https://explore.tempo.xyz" },
  },
  84532: {
    name: "Base Sepolia",
    icon: "base",
    explorer: { name: "Basescan", url: "https://sepolia.basescan.org" },
  },
  421614: {
    name: "Arbitrum Sepolia",
    icon: "arbitrum",
    explorer: { name: "Arbiscan", url: "https://sepolia.arbiscan.io" },
    // docs.arbitrum.io: USDC.e is USDC bridged from Ethereum, a different contract from native USDC.
    lookalikes: { USDC: "USDC.e" },
  },
  5042002: {
    name: "Arc Testnet",
    icon: "arc",
    explorer: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  42431: {
    name: "Tempo Moderato",
    icon: "tempo",
    explorer: { name: "Tempo Explorer", url: "https://explore.testnet.tempo.xyz" },
  },
  31337: { name: "Anvil (local)" },
};

export const TOKEN_ICONS: Readonly<Record<string, BrandIconName>> = {
  USDC: "usdc",
  USDT: "usdt",
  OUSD: "ousd",
};

/** NEAR Intents 1Click's chain names as payers know them (D-123); blockchainName writes any other in capitals. */
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

/** The one chain and token a cross-chain payment delivers: USDC on Base, as 1Click names it. */
export const CROSS_CHAIN_TARGET = {
  chainId: 8453,
  token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  decimals: 6,
  asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  symbol: "USDC",
} as const;

/** Explorers of chains 1Click names, by its name of the chain; a transaction's hash follows the url (R-243). */
export const BLOCKCHAIN_EXPLORERS: Record<string, { name: string; url: string }> = {
  eth: { name: "Etherscan", url: "https://etherscan.io/tx/" },
  base: { name: "Basescan", url: "https://basescan.org/tx/" },
  arb: { name: "Arbiscan", url: "https://arbiscan.io/tx/" },
  op: { name: "Optimism Explorer", url: "https://optimistic.etherscan.io/tx/" },
  pol: { name: "PolygonScan", url: "https://polygonscan.com/tx/" },
  bsc: { name: "BscScan", url: "https://bscscan.com/tx/" },
  avax: { name: "Snowtrace", url: "https://snowtrace.io/tx/" },
  gnosis: { name: "Gnosisscan", url: "https://gnosisscan.io/tx/" },
  sol: { name: "Solscan", url: "https://solscan.io/tx/" },
  tron: { name: "Tronscan", url: "https://tronscan.org/#/transaction/" },
  btc: { name: "mempool.space", url: "https://mempool.space/tx/" },
  near: { name: "NearBlocks", url: "https://nearblocks.io/txns/" },
};
