import { Money } from "@forwend/ui-web";
import { exactDigits } from "@/shared/lib/money";
export interface PaymentAmountProps {
  amount: string;
  decimals: number;
  symbol: string;
  /** Keeps the figures and the token on one line, as a table cell needs. */
  nowrap?: boolean;
  className?: string;
}
export function PaymentAmount({ amount, decimals, symbol, nowrap, className }: PaymentAmountProps) {
  const units = BigInt(amount);
  return (
    <Money
      baseUnits={units}
      decimals={decimals}
      fractionDigits={exactDigits(units < 0n ? -units : units, decimals)}
      token={symbol}
      nowrap={nowrap}
      className={className}
    />
  );
}
