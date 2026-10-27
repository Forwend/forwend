import { Money } from "@forwend/ui-web";
import { exactDigits } from "@/shared/lib/money";
export interface PaymentAmountProps {
  amount: string;
  decimals: number;
  symbol: string;
  className?: string;
}
export function PaymentAmount({ amount, decimals, symbol, className }: PaymentAmountProps) {
  const units = BigInt(amount);
  return (
    <Money
      baseUnits={units}
      decimals={decimals}
      fractionDigits={exactDigits(units < 0n ? -units : units, decimals)}
      token={symbol}
      className={className}
    />
  );
}
