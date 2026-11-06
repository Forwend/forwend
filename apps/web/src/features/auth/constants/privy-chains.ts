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

/** The networks Privy signs on (S-9): a send on a chain missing here never returns, so Send refuses one. Privy sends
 * sponsored transactions itself; these RPCs are only its fallback. */
export const PRIVY_CHAINS: Chain[] = [
  chain(84532, ether, "https://sepolia.base.org"),
  chain(421614, ether, "https://sepolia-rollup.arbitrum.io/rpc"),
  // Arc has no sponsorship: the wallet pays in USDC, and Privy uses this RPC from the browser (R-216).
  chain(5042002, { name: "USDC", symbol: "USDC", decimals: 18 }, WALLET_PAID_RPCS[5042002] ?? ""),
  chain(42431, { name: "USD", symbol: "USD", decimals: 18 }, "https://rpc.moderato.tempo.xyz"),
];
