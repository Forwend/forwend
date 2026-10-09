import type { BrandIconName } from "@forwend/ui-web";

/** The chains the API may return (packages/contracts/chains.json); every one today is a test network. */
export const CHAINS: Readonly<
  Record<number, { name: string; testnet: boolean; icon?: BrandIconName }>
> = {
  84532: { name: "Base Sepolia", testnet: true, icon: "base" },
  421614: { name: "Arbitrum Sepolia", testnet: true, icon: "arbitrum" },
  5042002: { name: "Arc Testnet", testnet: true, icon: "arc" },
  42431: { name: "Tempo Moderato", testnet: true, icon: "tempo" },
  31337: { name: "Anvil (local)", testnet: true },
};

/** Token logos by symbol. */
export const TOKEN_ICONS: Readonly<Record<string, BrandIconName>> = { USDC: "usdc", USDT: "usdt" };

/** The network's name, or its chain ID when this app does not know it. */
export function chainName(chainId: number): string {
  return CHAINS[chainId]?.name ?? `Chain ${chainId}`;
}

/** Unknown chains count as test networks: never imply real value. */
export function isTestnet(chainId: number): boolean {
  return CHAINS[chainId]?.testnet ?? true;
}
