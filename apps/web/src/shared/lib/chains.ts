import { CHAINS } from "@/shared/constants/chains";

/** The network's name, or its chain ID when this app does not know it. */
export function chainName(chainId: number): string {
  return CHAINS[chainId]?.name ?? `Chain ${chainId}`;
}

/** A bridged token on this network that looks like `symbol` (USDC.e for USDC on Arbitrum), or undefined. */
export function lookalikeOf(chainId: number, symbol: string): string | undefined {
  return CHAINS[chainId]?.lookalikes?.[symbol];
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
