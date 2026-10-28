import { formatTokenAmount } from "@forwend/ui-web";
import { MAX_FETCH_AGE_MS, MAX_SOURCE_AGE_MS } from "@/features/prices/constants/prices";
import type { PricesStatus, TokenAmount, TokenPrice } from "@/features/prices/types/prices";

/** The token's price on its chain, matched by contract in any letter case. */
export function findPrice(
  prices: readonly TokenPrice[],
  chainId: number,
  token: string,
): TokenPrice | undefined {
  const contract = token.toLowerCase();
  return prices.find((p) => p.chainId === chainId && p.token.toLowerCase() === contract);
}

/** The price's USD text while it may be shown at now: null without one or once stale, never "1" in its place. */
export function freshUsd(price: TokenPrice | undefined, now: number): string | null {
  if (!price?.usd || price.stale || !price.fetchedAt || !price.sourceUpdatedAt) return null;
  const old =
    now - Date.parse(price.fetchedAt) > MAX_FETCH_AGE_MS ||
    now - Date.parse(price.sourceUpdatedAt) > MAX_SOURCE_AGE_MS;
  return old ? null : price.usd;
}

// baseUnits × usd exactly: numerator / 10^exponent.
function exactValue(baseUnits: bigint, decimals: number, usd: string) {
  const [whole, fraction = ""] = usd.split(".");
  return { numerator: baseUnits * BigInt(whole + fraction), exponent: decimals + fraction.length };
}

/** The USD value in cents of an amount in base units at a decimal price, cut (never rounded up). */
export function usdCents(baseUnits: bigint, decimals: number, usd: string): bigint {
  const { numerator, exponent } = exactValue(baseUnits, decimals, usd);
  return (numerator * 100n) / 10n ** BigInt(exponent);
}

/** The USD value in cents of the amounts together, cut once. null when an amount above zero has no fresh price. */
export function totalUsdCents(
  prices: readonly TokenPrice[],
  amounts: readonly TokenAmount[],
  now: number,
): bigint | null {
  const values = [];
  for (const a of amounts) {
    if (a.baseUnits === 0n) continue;
    const usd = freshUsd(findPrice(prices, a.chainId, a.token), now);
    if (usd === null) return null;
    values.push(exactValue(a.baseUnits, a.decimals, usd));
  }
  const exponent = Math.max(0, ...values.map((v) => v.exponent));
  const sum = values.reduce((s, v) => s + v.numerator * 10n ** BigInt(exponent - v.exponent), 0n);
  return (sum * 100n) / 10n ** BigInt(exponent);
}

export function formatUsdCents(cents: bigint): string {
  return formatTokenAmount({ baseUnits: cents, decimals: 2 });
}

export function pricesStatus(prices: readonly TokenPrice[], now: number): PricesStatus {
  const reads = prices.flatMap((p) => (p.fetchedAt ? [p.fetchedAt] : []));
  const updatedAt = reads.length
    ? reads.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a))
    : null;
  return { updatedAt, stale: prices.some((p) => p.coinId !== null && freshUsd(p, now) === null) };
}
