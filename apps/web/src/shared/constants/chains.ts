import type { BrandIconName } from "@forwend/ui-web";

/** A block explorer: its name for link labels and its base URL; transactions are at /tx/<hash>. */
interface Explorer {
  name: string;
  url: string;
}

/**
 * The chains the API may return (packages/contracts/chains.json); every one today is a test network. Explorers from
 * each network's docs: docs.base.org, docs.arbitrum.io (chain info), docs.arc.io (connect to Arc),
 * tempo.xyz/developers (connection details). A local chain has none.
 */
export const CHAINS: Readonly<
  Record<number, { name: string; icon?: BrandIconName; explorer?: Explorer }>
> = {
  84532: {
    name: "Base Sepolia",
    icon: "base",
    explorer: { name: "Basescan", url: "https://sepolia.basescan.org" },
  },
  421614: {
    name: "Arbitrum Sepolia",
    icon: "arbitrum",
    explorer: { name: "Arbiscan", url: "https://sepolia.arbiscan.io" },
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

/** Token logos by symbol. */
export const TOKEN_ICONS: Readonly<Record<string, BrandIconName>> = {
  USDC: "usdc",
  USDT: "usdt",
  OUSD: "ousd",
};
