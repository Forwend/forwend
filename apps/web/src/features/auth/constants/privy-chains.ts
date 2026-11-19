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

/** Privy signs only on these chains: a send on a missing one never returns. */
export const PRIVY_CHAINS: Chain[] = [
  chain(8453, ether, "https://base-rpc.publicnode.com"),
  chain(42161, ether, "https://arb1.arbitrum.io/rpc"),
  chain(5042, arcUsdc, WALLET_PAID_RPCS[5042] ?? ""),
  chain(4217, tempoUsd, WALLET_PAID_RPCS[4217] ?? ""),
  chain(84532, ether, "https://sepolia.base.org"),
  chain(421614, ether, "https://sepolia-rollup.arbitrum.io/rpc"),
  chain(5042002, arcUsdc, WALLET_PAID_RPCS[5042002] ?? ""),
  chain(42431, tempoUsd, WALLET_PAID_RPCS[42431] ?? ""),
];
