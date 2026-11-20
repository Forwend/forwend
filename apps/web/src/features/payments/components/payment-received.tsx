import { Money } from "@forwend/ui-web";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { PAYMENTS_COPY } from "@/features/payments/constants/payments-copy";
import { leadOption, receivedAmount } from "@/features/payments/lib/payments";
import type { Payment } from "@/features/payments/types/payments";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { API_PAYMENT_STATUSES } from "@/shared/constants/payment-state";
import { chainName } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

export interface PaymentReceivedProps {
  payment: Pick<
    Payment,
    | "receipts"
    | "amounts"
    | "decimals"
    | "symbol"
    | "paymentStatus"
    | "amount"
    | "optionId"
    | "optionLocked"
    | "optionCount"
  >;
  compact?: boolean;
}

export function PaymentReceived({ payment, compact }: PaymentReceivedProps) {
  const receipts = payment.receipts ?? [];
  if (compact) {
    const received = receipts.length
      ? leadOption(payment, receipts, (r) => BigInt(r.received) > 0n)
      : {
          received: receivedAmount(payment.amounts),
          decimals: payment.decimals,
          symbol: payment.symbol,
        };
    const asked = (
      <PaymentAmount
        amount={payment.amount}
        decimals={payment.decimals}
        symbol={payment.optionCount > 1 ? MONEY_COPY.usd : payment.symbol}
        nowrap
      />
    );
    if (!received || BigInt(received.received) === 0n) return asked;
    // Every accepted token is priced 1:1 against the request, so both compare once at the same decimals.
    const got = BigInt(received.received) * 10n ** BigInt(payment.decimals);
    const want = BigInt(payment.amount) * 10n ** BigInt(received.decimals);
    if (got === want) return asked;
    const units = BigInt(received.received);
    return (
      <span title={got > want ? PAYMENTS_COPY.over : undefined} className="whitespace-nowrap">
        <span className="text-muted">
          <Money
            baseUnits={units}
            decimals={received.decimals}
            fractionDigits={exactDigits(units, received.decimals)}
            token={payment.optionCount > 1 ? received.symbol : undefined}
            nowrap
          />{" "}
          {PAYMENTS_COPY.of}
        </span>{" "}
        {asked}
        {got > want ? <span className="sr-only"> ({PAYMENTS_COPY.over})</span> : null}
      </span>
    );
  }
  if (!receipts.length) {
    if (payment.paymentStatus === API_PAYMENT_STATUSES.detected)
      return <span className="text-muted">{PAYMENTS_COPY.confirming}</span>;
    return (
      <PaymentAmount
        amount={receivedAmount(payment.amounts)}
        decimals={payment.decimals}
        symbol={payment.symbol}
      />
    );
  }
  return (
    <span className="inline-flex flex-col gap-1">
      {receipts.map((receipt) => (
        <span key={receipt.optionId} className="flex flex-col">
          <span>
            <PaymentAmount
              amount={receipt.received}
              decimals={receipt.decimals}
              symbol={receipt.symbol}
            />
            {receipts.length > 1 ? (
              <span className="text-xs text-muted"> · {chainName(receipt.chainId)}</span>
            ) : null}
          </span>
          {BigInt(receipt.pending) > 0n ? (
            <span className="text-xs text-muted">
              <PaymentAmount
                amount={receipt.pending}
                decimals={receipt.decimals}
                symbol={receipt.symbol}
              />{" "}
              {PAYMENTS_COPY.pending}
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}
