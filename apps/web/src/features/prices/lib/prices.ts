import type { TokenAmount, TokenPrice } from "@/features/prices/types/prices";

export function findPrice(
  prices: readonly TokenPrice[],
  chainId: number,
  token: string,
): TokenPrice | undefined {
  const contract = token.toLowerCase();
  return prices.find((p) => p.chainId === chainId && p.token.toLowerCase() === contract);
}

// Even an old price; null only without any, never 1 in its place.
export function latestUsd(price: TokenPrice | undefined): string | null {
  return price?.usd ?? null;
}

function exactValue(baseUnits: bigint, decimals: number, usd: string) {
  const [whole, fraction = ""] = usd.split(".");
  return { numerator: baseUnits * BigInt(whole + fraction), exponent: decimals + fraction.length };
}

// Cut, never rounded up.
export function usdCents(baseUnits: bigint, decimals: number, usd: string): bigint {
  const { numerator, exponent } = exactValue(baseUnits, decimals, usd);
  return (numerator * 100n) / 10n ** BigInt(exponent);
}

// Cut once over the sum; null when an amount above zero has no price.
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
