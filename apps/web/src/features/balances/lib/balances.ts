import { formatTokenAmount } from "@forwend/ui-web";
import { USD_DECIMALS } from "@/features/balances/constants/balances";
import type { Balances } from "@/features/balances/types/balances";

export function formatUsd(cents: bigint): string {
  return formatTokenAmount({ baseUnits: cents, decimals: USD_DECIMALS });
}

// Each stablecoin counts as 1 USD; cut to cents once, never rounded up. Null when a wallet balance is missing.
export function usdTotal(balances: Balances, field: "wallet" | "pending" | "held"): bigint | null {
  if (balances.tokens.length === 0) return null;
  // Added at the finest decimals of any token, so no cent is lost per token.
  const finest = Math.max(...balances.tokens.map((t) => t.decimals));
  let sum = 0n;
  for (const t of balances.tokens) {
    const amount = t[field];
    if (amount === null) return null;
    sum += BigInt(amount) * 10n ** BigInt(finest - t.decimals);
  }
  return (sum * 10n ** BigInt(USD_DECIMALS)) / 10n ** BigInt(finest);
}
