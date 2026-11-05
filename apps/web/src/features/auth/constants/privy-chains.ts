import type { PrivyClientConfig } from "@privy-io/react-auth";

type Chain = NonNullable<PrivyClientConfig["supportedChains"]>[number];

const ether = { name: "Ether", symbol: "ETH", decimals: 18 } as const;

/** The networks Privy signs on (S-9): a send on a chain missing here never returns. Privy sends sponsored
 * transactions itself, so these RPCs are only its fallback, never the app's. */
export const PRIVY_CHAINS: Chain[] = [
  {
    id: 84532,
    name: "Base Sepolia",
    nativeCurrency: ether,
    rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
  },
  {
    id: 421614,
    name: "Arbitrum Sepolia",
    nativeCurrency: ether,
    rpcUrls: { default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] } },
  },
  {
    id: 5042002,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  },
  {
    id: 42431,
    name: "Tempo Moderato",
    nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.moderato.tempo.xyz"] } },
  },
];
