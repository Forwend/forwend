import { Money } from "@forwend/ui-web";
import { TRANSACTION_DIRECTIONS } from "@/features/transactions/constants/transactions";
import type { Transaction } from "@/features/transactions/types/transactions";

/** What arrived or was sent, never the fee: green with a plus for money in. */
export function SignedAmount({ t, className = "" }: { t: Transaction; className?: string }) {
  const incoming = t.direction === TRANSACTION_DIRECTIONS.in;
  return (
    <span className={`whitespace-nowrap ${incoming ? "text-success" : "text-ink"} ${className}`}>
      {incoming ? "+" : "−"}
      <Money baseUnits={BigInt(t.amount)} decimals={t.decimals} token={t.symbol} nowrap />
    </span>
  );
}
