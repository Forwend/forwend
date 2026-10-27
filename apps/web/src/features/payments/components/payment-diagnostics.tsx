"use client";
import { Button, SelectField } from "@forwend/ui-web";
import { useState } from "react";
import { useGetPaymentQuery } from "@/features/payments/api/payments-api";
import type { PaymentDetailProps } from "@/features/payments/components/payment-detail";
import { CopyValue } from "@/shared/components/copy-value";
import { chainName } from "@/shared/lib/chains";

export function PaymentDiagnostics({ profileId, paymentId }: PaymentDetailProps) {
  const read = useGetPaymentQuery({ profileId, paymentId, full: true });
  const [selected, setSelected] = useState<string>();
  const payment = read.currentData;
  if (!payment)
    return <p className="text-sm">{read.isError ? "Details unavailable." : "Loading details…"}</p>;
  const initial = payment.optionLocked
    ? payment.optionId
    : (payment.options.find((option) => option.deposits.length > 0)?.optionId ?? payment.optionId);
  const option = payment.options.find((option) => option.optionId === (selected ?? initial));
  return (
    <div className="flex flex-col gap-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>Updated {new Date(payment.snapshotAt).toLocaleString()}</span>
        <Button size="sm" variant="secondary" onClick={() => void read.refetch()}>
          Refresh details
        </Button>
      </div>
      <SelectField
        label="Payment option"
        value={option?.optionId ?? ""}
        onValueChange={setSelected}
        options={payment.options.map((option) => ({
          value: option.optionId,
          label: `${option.symbol} · ${chainName(option.chainId)}${option.optionId === payment.optionId && payment.optionLocked ? " · used" : ""}`,
        }))}
      />
      {option ? (
        <>
          <CopyValue
            label="Receive address"
            hint="Use the checkout link to request payment."
            value={option.receiveAddress}
            copyLabel="Copy receive address"
          />
          <p className="break-all">Token {option.token}</p>
          <p className="text-muted">
            Last checked block: {option.coverage.verifiedBlock ?? "Not checked yet"}.
            {option.coverage.unbookedDeposits > 0
              ? ` ${option.coverage.unbookedDeposits} incoming transfer${option.coverage.unbookedDeposits === 1 ? " is" : "s are"} still being checked.`
              : ""}
          </p>
          {option.coverage.reconciliationError || option.coverage.bookingError ? (
            <p className="break-words text-warning">
              {option.coverage.reconciliationError || option.coverage.bookingError}
            </p>
          ) : null}
          {option.settlement ? (
            <p>
              Wallet transfer: {option.settlement.status}
              {option.settlement.wait ? ` · ${option.settlement.wait}` : ""}. Attempts:{" "}
              {option.settlement.attempts}.
            </p>
          ) : null}
        </>
      ) : null}
      <section>
        <h3 className="mb-2 font-medium text-ink">Webhook deliveries</h3>
        {payment.deliveries.length ? (
          <ul className="divide-y divide-line">
            {payment.deliveries.map((delivery) => (
              <li key={`${delivery.endpointId}:${delivery.eventId}`} className="py-2">
                {delivery.eventType} · {delivery.status}
                {delivery.lastStatusCode ? ` · HTTP ${delivery.lastStatusCode}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p>No deliveries recorded.</p>
        )}
      </section>
    </div>
  );
}
