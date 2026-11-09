import { BLOCKCHAIN_NAMES, CHAINS } from "@/shared/constants/chains";
import { foldText } from "@/shared/lib/search";

export function chainName(chainId: number): string {
  return CHAINS[chainId]?.name ?? `Chain ${chainId}`;
}

/** Token lists get a search past a handful: a profile can have hundreds of tokens on. */
export const TOKEN_SEARCH_FROM = 10;

/** A token search matches its symbol or its network's name, so "usdc base" finds USDC on Base. */
export function tokenMatches(t: { symbol: string; chainId: number }, query: string): boolean {
  const text = foldText(`${t.symbol} ${chainName(t.chainId)}`);
  return foldText(query)
    .split(/\s+/)
    .every((word) => text.includes(word));
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

/** NEAR Intents 1Click's name of a chain as payers know it: "tron" is Tron (D-123). */
export function blockchainName(blockchain: string): string {
  return BLOCKCHAIN_NAMES[blockchain] ?? blockchain.toUpperCase();
}
