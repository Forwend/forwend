import { formatTokenAmount } from "@forwend/ui-web";

/** One enabled token's money for a profile (GET /v1/profiles/{id}/balances, TokenBalance). Amounts are base units. */
export interface TokenBalance {
  chainId: number;
  token: string;
  symbol: string;
  decimals: number;
  /** null when the wallet balance could not be read. */
  wallet: string | null;
  finalizedBlock: number | null;
  pending: string;
  held: string;
}

export interface Balances {
  tokens: TokenBalance[];
  /** Wallet balances at 1 USD per stablecoin, "12.50"; null when any balance is missing. */
  estimatedUsdTotal: string | null;
}

export const USD = "USD";
export const USD_DECIMALS = 2;

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
