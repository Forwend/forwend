import type { BrandIconName } from "@forwend/ui-web";

/** A block explorer: its name for link labels and its base URL; transactions are at /tx/<hash>. */
interface Explorer {
  name: string;
  url: string;
}

/** The chains the API may return (packages/contracts/chains.json); all are test networks today. Explorers come from
 * each network's docs; a local chain has none. */
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
