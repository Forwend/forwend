import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { leadOption, receivedAmount } from "@/features/payments/lib/payments";
import type { Payment } from "@/features/payments/types/payments";
import { chainName } from "@/shared/lib/chains";

const OVER = "More than requested; the extra is held for the customer";

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
  >;
  /** One line for a table row: the received total, or a dash when nothing arrived. */
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
    if (!received || BigInt(received.received) === 0n) {
      return <span className="text-subtle">—</span>;
    }
    // Every accepted token is priced 1:1 against the request, so the same decimals compare exactly.
    const over =
      received.decimals === payment.decimals && BigInt(received.received) > BigInt(payment.amount);
    return (
      <span className={over ? "text-warning" : undefined} title={over ? OVER : undefined}>
        <PaymentAmount
          amount={received.received}
          decimals={received.decimals}
          symbol={received.symbol}
        />
        {over ? <span className="sr-only"> ({OVER})</span> : null}
      </span>
    );
  }
  if (!receipts.length) {
    if (payment.paymentStatus === "detected") return <span className="text-muted">Confirming</span>;
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
              confirming
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}
