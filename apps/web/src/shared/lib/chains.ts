import { CHAINS } from "@/shared/constants/chains";

export function chainName(chainId: number): string {
  return CHAINS[chainId]?.name ?? `Chain ${chainId}`;
}

export function lookalikeOf(chainId: number, symbol: string): string | undefined {
  return CHAINS[chainId]?.lookalikes?.[symbol];
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export function addressLink(
  chainId: number,
  address: string,
): { name: string; href: string } | null {
  const explorer = CHAINS[chainId]?.explorer;
  if (!explorer || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  return { name: explorer.name, href: `${explorer.url}/address/${address}` };
}

export function txLink(chainId: number, txHash: string): { name: string; href: string } | null {
  const explorer = CHAINS[chainId]?.explorer;
  if (!explorer || !TX_HASH.test(txHash)) return null;
  return { name: explorer.name, href: `${explorer.url}/tx/${txHash}` };
}
