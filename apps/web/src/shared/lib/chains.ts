import {
  BLOCKCHAIN_EXPLORERS,
  BLOCKCHAIN_NAMES,
  CHAINS,
  CROSS_CHAIN_STATUSES,
  CROSS_CHAIN_TARGET,
} from "@/shared/constants/chains";
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

/** 1Click returned the payer's money, or will: it doesn't pay the invoice, which can be paid again (R-238). */
export function crossChainEnded(c: { status: string }): boolean {
  return (
    c.status === CROSS_CHAIN_STATUSES.refunded ||
    c.status === CROSS_CHAIN_STATUSES.failed ||
    c.status === CROSS_CHAIN_STATUSES.incomplete
  );
}

/** The option a cross-chain payment delivers to (D-123). */
export function isCrossChainTarget(o: { chainId: number; token: string } | undefined): boolean {
  return (
    o?.chainId === CROSS_CHAIN_TARGET.chainId && o.token.toLowerCase() === CROSS_CHAIN_TARGET.token
  );
}

/** No money recorded yet, or recorded on the option 1Click delivers to. Money booked first on another option pays the
 * payment instead, and 1Click's USDC is then held for the customer (R-239). */
export function crossChainOptionRecorded(x: {
  optionLocked: boolean;
  optionId: string;
  options: readonly { optionId: string; chainId: number; token: string }[];
}): boolean {
  return !x.optionLocked || isCrossChainTarget(x.options.find((o) => o.optionId === x.optionId));
}

/** A transaction on a chain 1Click names: a known explorer's link, else 1Click's own https one; null for neither. */
export function blockchainTxLink(
  blockchain: string,
  tx: { hash: string; explorerUrl: string },
): { name: string; href: string } | null {
  const explorer = BLOCKCHAIN_EXPLORERS[blockchain];
  if (explorer && /^[0-9A-Za-z]{16,128}$/.test(tx.hash))
    return { name: explorer.name, href: explorer.url + tx.hash };
  return tx.explorerUrl.startsWith("https://")
    ? { name: blockchainName(blockchain), href: tx.explorerUrl }
    : null;
}
