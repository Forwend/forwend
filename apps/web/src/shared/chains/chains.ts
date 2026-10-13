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
  Record<number, { name: string; testnet: boolean; icon?: BrandIconName; explorer?: Explorer }>
> = {
  84532: {
    name: "Base Sepolia",
    testnet: true,
    icon: "base",
    explorer: { name: "Basescan", url: "https://sepolia.basescan.org" },
  },
  421614: {
    name: "Arbitrum Sepolia",
    testnet: true,
    icon: "arbitrum",
    explorer: { name: "Arbiscan", url: "https://sepolia.arbiscan.io" },
  },
  5042002: {
    name: "Arc Testnet",
    testnet: true,
    icon: "arc",
    explorer: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  42431: {
    name: "Tempo Moderato",
    testnet: true,
    icon: "tempo",
    explorer: { name: "Tempo Explorer", url: "https://explore.testnet.tempo.xyz" },
  },
  31337: { name: "Anvil (local)", testnet: true },
};

/** Token logos by symbol. */
export const TOKEN_ICONS: Readonly<Record<string, BrandIconName>> = {
  USDC: "usdc",
  USDT: "usdt",
  OUSD: "ousd",
};

/** The network's name, or its chain ID when this app does not know it. */
export function chainName(chainId: number): string {
  return CHAINS[chainId]?.name ?? `Chain ${chainId}`;
}

/** Unknown chains count as test networks: never imply real value. */
export function isTestnet(chainId: number): boolean {
  return CHAINS[chainId]?.testnet ?? true;
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** The address's page on the chain's explorer, or null for a chain without one or a value that is not an address. */
export function addressLink(
  chainId: number,
  address: string,
): { name: string; href: string } | null {
  const explorer = CHAINS[chainId]?.explorer;
  if (!explorer || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  return { name: explorer.name, href: `${explorer.url}/address/${address}` };
}

/** The transaction's page on the chain's explorer, or null for a chain without one or a value that is not a hash. */
export function txLink(chainId: number, txHash: string): { name: string; href: string } | null {
  const explorer = CHAINS[chainId]?.explorer;
  if (!explorer || !TX_HASH.test(txHash)) return null;
  return { name: explorer.name, href: `${explorer.url}/tx/${txHash}` };
}
