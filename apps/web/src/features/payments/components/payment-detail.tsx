"use client";
import { Badge, Button, buttonClasses, TONES } from "@forwend/ui-web";
import Link from "next/link";
import { useGetPaymentQuery } from "@/features/payments/api/payments-api";
import { ExportPayments } from "@/features/payments/components/export-payments";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { PaymentMovements } from "@/features/payments/components/payment-movements";
import { PaymentProblems } from "@/features/payments/components/payment-problems";
import { SOURCE_LABELS } from "@/features/payments/constants/payments";
import { paymentLabel, paymentState, settlementState } from "@/features/payments/lib/payments";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { NetworkName } from "@/shared/components/chains/network-name";
import { CopyValue } from "@/shared/components/copy-value";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
export interface PaymentDetailProps {
  profileId: string;
  paymentId: string;
}
export function PaymentDetail({ profileId, paymentId }: PaymentDetailProps) {
  const read = useGetPaymentQuery({ profileId, paymentId }, LIVE_QUERY);
  const payment = read.currentData;
  if (!payment)
    return read.isError ? (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
        Payment unavailable or outside your access.
        <Button variant="secondary" onClick={() => void read.refetch()}>
          Try again
        </Button>
      </div>
    ) : (
      <p role="status" className="text-sm text-muted">
        Loading payment…
      </p>
    );
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link href={APP_ROUTES.payments} className="text-sm text-info underline underline-offset-4">
          Back to payments
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-semibold tracking-tight text-ink">
              {paymentLabel(payment)}
            </h1>
            <p className="text-sm text-muted">
              {SOURCE_LABELS[payment.source]}
              {payment.storeName ? ` · ${payment.storeName}` : ""}
            </p>
          </div>
          <ExportPayments profileId={profileId} paymentId={paymentId} />
        </div>
        {payment.livemode ? null : (
          <span>
            <Badge tone={TONES.warning}>Test mode</Badge>
          </span>
        )}
      </header>
      {read.isError ? (
        <p role="alert" className="text-sm text-danger">
          We could not refresh this payment. The last loaded snapshot is shown.
        </p>
      ) : null}
      <section aria-labelledby="payment-state" className="fw-panel p-4 sm:p-5">
        <h2 id="payment-state" className="text-lg font-semibold text-ink">
          {paymentState(payment)}
        </h2>
        <p className="mt-1 text-muted">
          Requested{" "}
          <PaymentAmount
            amount={payment.amount}
            decimals={payment.decimals}
            symbol={payment.optionCount > 1 ? "USD" : payment.symbol}
          />
        </p>
        <p className="mt-1 text-sm text-muted">
          {settlementState(payment.settlementStatus)}. Payment confirmation and wallet settlement
          are separate.
        </p>
        <p className="mt-2 text-xs text-muted">
          Snapshot {new Date(payment.snapshotAt).toLocaleString()}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {payment.hostedUrl ? (
            <a
              href={payment.hostedUrl}
              className={buttonClasses({ size: "sm", variant: "secondary" })}
            >
              {payment.paymentStatus === "paid"
                ? "View customer receipt"
                : payment.closed
                  ? "View closed checkout"
                  : "Open customer checkout"}
            </a>
          ) : null}
          {payment.documentKind !== "none" ? (
            <Link
              href={`${APP_ROUTES.invoices}/${payment.paymentId}`}
              className={buttonClasses({ size: "sm", variant: "secondary" })}
            >
              {payment.documentKind === "request" ? "View request" : "View invoice"}
            </Link>
          ) : null}
          {payment.linkId ? (
            <Link
              href={`${APP_ROUTES.links}/${payment.linkId}`}
              className={buttonClasses({ size: "sm", variant: "secondary" })}
            >
              View payment link
            </Link>
          ) : null}
        </div>
        {payment.reference ? (
          <p className="mt-3 break-all text-sm text-muted">
            Order / reference: {payment.reference}
          </p>
        ) : null}
        {payment.customer.name || payment.customer.email ? (
          <p className="mt-2 break-words text-sm text-muted">
            Customer: {[payment.customer.name, payment.customer.email].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </section>
      {payment.problems.length ? (
        <section aria-labelledby="payment-problems" className="fw-panel p-4 sm:p-5">
          <h2 id="payment-problems" className="mb-4 font-semibold text-ink">
            Needs attention
          </h2>
          <PaymentProblems problems={payment.problems} hostedUrl={payment.hostedUrl} />
        </section>
      ) : null}
      <section aria-labelledby="payment-options" className="flex flex-col gap-4">
        <div>
          <h2 id="payment-options" className="text-lg font-semibold text-ink">
            Receive contracts and funds
          </h2>
          <p className="text-sm text-muted">
            Balances stay separate by token and network. Held funds belong to the payer; they are
            not a pending refund.
          </p>
        </div>
        {payment.options.map((option) => (
          <article key={option.optionId} className="fw-panel overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
              <h3 className="font-medium text-ink">
                {option.symbol} · <NetworkName chainId={option.chainId} />
              </h3>
              {payment.optionLocked && option.optionId === payment.optionId ? (
                <Badge tone={TONES.neutral}>Payment option used</Badge>
              ) : null}
            </header>
            <div className="flex flex-col gap-4 p-4 sm:p-5">
              <p className="break-all font-mono text-xs text-muted">Token {option.token}</p>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {(
                  [
                    { key: "receiver", label: "In receive contract" },
                    { key: "payable", label: "Owed to merchant" },
                    { key: "held", label: "Held for payer" },
                    { key: "settled", label: "Settled into wallet" },
                    { key: "refunded", label: "Returned, booked" },
                    { key: "observedRefunded", label: "Returns observed on chain" },
                  ] as const
                ).map((row) => (
                  <div key={row.key}>
                    <dt className="text-sm text-muted">{row.label}</dt>
                    <dd className="text-ink">
                      <PaymentAmount
                        amount={option.amounts[row.key]}
                        decimals={option.decimals}
                        symbol={option.symbol}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
              <CopyValue
                label="Receive contract"
                value={option.receiveAddress}
                hint="For investigating this payment. Share the hosted checkout with customers."
                copyLabel="Copy receive contract"
              />
              <div className="text-sm text-muted">
                <p>
                  {option.coverage.historyComplete
                    ? "Historical coverage complete"
                    : "Historical coverage incomplete"}
                  . Verified block {option.coverage.verifiedBlock ?? "unknown"}; latest finalized
                  block {option.coverage.chainFinalizedBlock ?? "unknown"}.
                </p>
                <p>
                  Checkpoint difference:{" "}
                  {option.coverage.balanceDifference === null ? (
                    "Not comparable"
                  ) : (
                    <PaymentAmount
                      amount={option.coverage.balanceDifference}
                      decimals={option.decimals}
                      symbol={option.symbol}
                    />
                  )}
                  .
                </p>
                <p>
                  Pending deposits {option.coverage.pendingDeposits}; unbooked deposits{" "}
                  {option.coverage.unbookedDeposits}; unbooked outgoing movements{" "}
                  {option.coverage.unbookedOutflows}.
                </p>
              </div>
              {option.settlement ? (
                <div className="border-t border-line pt-3 text-sm">
                  <h4 className="font-medium text-ink">Settlement record</h4>
                  <p className="text-muted">
                    {option.settlement.status} · {option.settlement.attempts} attempts
                    {option.settlement.wait ? ` · waiting: ${option.settlement.wait}` : ""}
                  </p>
                  {option.settlement.txHash ? (
                    <ExplorerLink
                      chainId={option.chainId}
                      txHash={option.settlement.txHash}
                      named
                    />
                  ) : null}
                </div>
              ) : null}
              {option.deposits.length ? (
                <div className="border-t border-line pt-3">
                  <h4 className="font-medium text-ink">Deposits</h4>
                  <ul className="mt-2 divide-y divide-line">
                    {option.deposits.map((deposit) => (
                      <li
                        key={`${deposit.txHash}:${deposit.logIndex}`}
                        className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                      >
                        <span>
                          <PaymentAmount
                            amount={deposit.amount}
                            decimals={option.decimals}
                            symbol={option.symbol}
                          />{" "}
                          · {deposit.status}
                          {deposit.late ? " · after checkout closed" : ""}
                        </span>
                        <ExplorerLink chainId={option.chainId} txHash={deposit.txHash} />
                      </li>
                    ))}
                  </ul>
                  {option.depositsTruncated ? (
                    <p className="text-sm text-muted">
                      Showing the latest 100 deposits. Use movements or CSV for more.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </section>
      <PaymentMovements profileId={profileId} paymentId={paymentId} />
      <section aria-labelledby="payment-deliveries" className="fw-panel p-4 sm:p-5">
        <h2 id="payment-deliveries" className="font-semibold text-ink">
          Webhook deliveries
        </h2>
        <p className="mt-1 text-sm text-muted">
          Delivery failures do not change whether the customer paid.
        </p>
        {payment.deliveries.length ? (
          <ul className="mt-3 divide-y divide-line">
            {payment.deliveries.map((delivery) => (
              <li
                key={`${delivery.endpointId}:${delivery.eventId}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div>
                  <p className="text-ink">
                    {delivery.eventType} · {delivery.status}
                    {!delivery.enabled ? " · endpoint off" : ""}
                  </p>
                  <p className="text-muted">
                    {delivery.attempts} attempts
                    {delivery.lastStatusCode ? ` · HTTP ${delivery.lastStatusCode}` : ""}
                  </p>
                </div>
                {delivery.canManage ? (
                  <Link
                    href={APP_ROUTES.developers}
                    className="text-info underline underline-offset-4"
                  >
                    Check delivery
                  </Link>
                ) : delivery.status !== "delivered" ? (
                  <span className="text-muted">Ask an Admin to check delivery.</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">No deliveries recorded for this payment.</p>
        )}
        {payment.deliveriesTruncated ? (
          <p className="mt-3 text-sm text-muted">
            Showing 100 of {payment.deliveryCount} deliveries, with problems first. Open Developers
            for endpoint history.
          </p>
        ) : null}
      </section>
    </div>
  );
}
