import { formatTokenAmount } from "@forwend/ui-web";
import type { TokenAmount, TokenPrice } from "@/features/prices/types/prices";

/** The token's price on its chain, matched by contract in any letter case. */
export function findPrice(
  prices: readonly TokenPrice[],
  chainId: number,
  token: string,
): TokenPrice | undefined {
  const contract = token.toLowerCase();
  return prices.find((p) => p.chainId === chainId && p.token.toLowerCase() === contract);
}

/** The latest market price's USD text, even an old one: stablecoins move little, and a value at the last known
 * price reads better than none. null only without any price, never "1" in its place. */
export function latestUsd(price: TokenPrice | undefined): string | null {
  return price?.usd ?? null;
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

/** The USD value in cents of the amounts together, cut once. null when an amount above zero has no price. */
export function totalUsdCents(
  prices: readonly TokenPrice[],
  amounts: readonly TokenAmount[],
): bigint | null {
  const values = [];
  for (const a of amounts) {
    if (a.baseUnits === 0n) continue;
    const usd = latestUsd(findPrice(prices, a.chainId, a.token));
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
