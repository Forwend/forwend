import { BALANCE_FIELDS } from "@/features/balances/constants/balances";
import type { BalanceField, Balances, TokenBalance } from "@/features/balances/types/balances";
import { totalUsdCents } from "@/features/prices/lib/prices";
import type { TokenPrice } from "@/features/prices/types/prices";

// An older API read has no settling part: its pending is the nearest.
const settling = (t: TokenBalance) => t.settling ?? t.pending;

function notFinal(t: TokenBalance): string {
  return (BigInt(t.pending) - BigInt(settling(t))).toString();
}

export function fieldUnits(t: TokenBalance, field: BalanceField): string | null {
  if (field === BALANCE_FIELDS.notFinal) return notFinal(t);
  if (field === BALANCE_FIELDS.settling) return settling(t);
  if (field === BALANCE_FIELDS.confirming || field === BALANCE_FIELDS.partial)
    return t[field] ?? "0";
  return t[field];
}

// null while a balance is unread or a token has no price: never valued at 1 USD.
export function marketUsd(
  balances: Balances,
  field: BalanceField,
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
