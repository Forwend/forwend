import type { PrivyClientConfig } from "@privy-io/react-auth";
import { WALLET_PAID_RPCS } from "@/shared/config/security-headers";
import { chainName } from "@/shared/lib/chains";

type Chain = NonNullable<PrivyClientConfig["supportedChains"]>[number];

const ether = { name: "Ether", symbol: "ETH", decimals: 18 } as const;

const chain = (id: number, nativeCurrency: Chain["nativeCurrency"], rpc: string): Chain => ({
  id,
  name: chainName(id),
  nativeCurrency,
  rpcUrls: { default: { http: [rpc] } },
});

const arcUsdc = { name: "USDC", symbol: "USDC", decimals: 18 } as const;
const tempoUsd = { name: "USD", symbol: "USD", decimals: 18 } as const;

/** The networks Privy signs on (S-9): a send on a chain missing here never returns, so Send refuses one. Privy sends
 * sponsored transactions itself; these RPCs are only its fallback. */
export const PRIVY_CHAINS: Chain[] = [
  chain(8453, ether, "https://base-rpc.publicnode.com"),
  chain(42161, ether, "https://arb1.arbitrum.io/rpc"),
  // Arc has no sponsorship: the wallet pays in USDC, and Privy uses this RPC from the browser (R-216).
  chain(5042, arcUsdc, WALLET_PAID_RPCS[5042] ?? ""),
  // Tempo mainnet has no sponsorship either: the wallet pays in the token it sends (R-223).
  chain(4217, tempoUsd, WALLET_PAID_RPCS[4217] ?? ""),
  chain(84532, ether, "https://sepolia.base.org"),
  chain(421614, ether, "https://sepolia-rollup.arbitrum.io/rpc"),
  chain(5042002, arcUsdc, WALLET_PAID_RPCS[5042002] ?? ""),
  chain(42431, tempoUsd, "https://rpc.moderato.tempo.xyz"),
];
