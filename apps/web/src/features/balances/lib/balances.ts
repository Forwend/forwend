import { formatTokenAmount } from "@forwend/ui-web";
import { USD_DECIMALS } from "@/features/balances/constants/balances";
import type { Balances, TokenBalance } from "@/features/balances/types/balances";
import { totalUsdCents } from "@/features/prices/lib/prices";
import type { TokenPrice } from "@/features/prices/types/prices";

export function formatUsd(cents: bigint): string {
  return formatTokenAmount({ baseUnits: cents, decimals: USD_DECIMALS });
}

/** Holdings at market prices (D-115), cut to cents once. null while a balance is unread or a held token has no
 * fresh price: never valued at 1 USD instead. */
// An older read has no settling part: its pending is the nearest it has, and it has no confirming or partial part.
const settling = (t: TokenBalance) => t.settling ?? t.pending;

/** Confirming and partly paid money: not the creator's for certain yet, as some may turn out held for the payer. */
export function notFinal(t: TokenBalance): string {
  return (BigInt(t.pending) - BigInt(settling(t))).toString();
}

type Field = "wallet" | "pending" | "held" | "settling" | "notFinal" | "confirming" | "partial";

/** A token's base units for one field; null for a wallet balance not read yet. */
export function fieldUnits(t: TokenBalance, field: Field): string | null {
  if (field === "notFinal") return notFinal(t);
  if (field === "settling") return settling(t);
  if (field === "confirming" || field === "partial") return t[field] ?? "0";
  return t[field];
}

export function marketUsd(
  balances: Balances,
  field: Field,
  prices: readonly TokenPrice[] | undefined,
): bigint | null {
  if (!prices || balances.tokens.length === 0) return null;
  const amounts = [];
  for (const t of balances.tokens) {
    const amount = fieldUnits(t, field);
    if (amount === null) return null;
    amounts.push({
      chainId: t.chainId,
      token: t.token,
      baseUnits: BigInt(amount),
      decimals: t.decimals,
    });
  }
  return totalUsdCents(prices, amounts);
}
