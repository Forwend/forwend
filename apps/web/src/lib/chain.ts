import { CHAINS } from "@/constants/app";

/** The network's name, or its chain ID when this app does not know it. */
export function chainName(chainId: number): string {
  return CHAINS[chainId]?.name ?? `Chain ${chainId}`;
}

/** Unknown chains count as test networks: never imply real value. */
export function isTestnet(chainId: number): boolean {
  return CHAINS[chainId]?.testnet ?? true;
}
