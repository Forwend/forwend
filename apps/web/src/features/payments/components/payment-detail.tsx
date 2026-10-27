"use client";
import { Accordion, Button, buttonClasses, StatusPill } from "@forwend/ui-web";
import Link from "next/link";
import { useGetPaymentQuery } from "@/features/payments/api/payments-api";
import { ExportPayments } from "@/features/payments/components/export-payments";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { PaymentDiagnostics } from "@/features/payments/components/payment-diagnostics";
import { PaymentMovements } from "@/features/payments/components/payment-movements";
import { PaymentProblems } from "@/features/payments/components/payment-problems";
import { PaymentReceived } from "@/features/payments/components/payment-received";
import { SOURCE_LABELS } from "@/features/payments/constants/payments";
import {
  paymentDisplayStatus,
  paymentLabel,
  settlementState,
} from "@/features/payments/lib/payments";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { NetworkName } from "@/shared/components/chains/network-name";
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
        Payment unavailable.
        <Button variant="secondary" onClick={() => void read.refetch()}>
          Try again
        </Button>
      </div>
    ) : (
      <p role="status" className="text-sm text-muted">
        Loading payment…
      </p>
    );
  const funded = payment.options.filter(
    (option) =>
      option.deposits.length > 0 || (payment.optionLocked && option.optionId === payment.optionId),
  );
  const used = funded.length
    ? funded
    : payment.options.filter((option) => option.optionId === payment.optionId);
  const problems = payment.problems.filter(
    (problem) => problem.code !== "verification_pending" && problem.code !== "partial_payment",
  );
  const confirming =
    payment.confirming ||
    payment.paymentStatus === "detected" ||
    payment.problems.some(
      (problem) => problem.code === "partial_payment" && problem.action === "wait",
    );
  const delayed =
    confirming &&
    used.some((option) =>
      option.deposits.some(
        (deposit) =>
          deposit.status === "confirmed" &&
          deposit.paid === null &&
          Date.parse(payment.snapshotAt) - Date.parse(deposit.blockTime) > 5 * 60 * 1000,
      ),
    );
  const needsReview = problems.some(
    (problem) => problem.action === "review_funds" && problem.code !== "held_funds",
  );
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href={APP_ROUTES.payments}
          className="self-start text-sm text-info underline underline-offset-4"
        >
          Back to payments
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="break-words text-2xl font-semibold tracking-tight text-ink">
                {paymentLabel(payment)}
              </h1>
              {!payment.livemode ? (
                <span className="shrink-0 text-xs text-warning">Testnet</span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted">
              {SOURCE_LABELS[payment.source]}
              {payment.storeName ? ` · ${payment.storeName}` : ""}
            </p>
          </div>
          <ExportPayments profileId={profileId} paymentId={paymentId} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-3xl font-semibold tracking-tight text-ink">
            <PaymentAmount
              amount={payment.amount}
              decimals={payment.decimals}
              symbol={payment.optionCount > 1 ? "USD" : payment.symbol}
            />
          </span>
          <StatusPill status={paymentDisplayStatus(payment)} />
        </div>
      </header>
      {read.isError ? (
        <p role="alert" className="text-sm text-danger">
          Updates unavailable. Showing the last payment update.
        </p>
      ) : null}
      {problems.length ? (
        <PaymentProblems problems={problems} hostedUrl={payment.hostedUrl} />
      ) : null}
      <dl className="grid gap-x-8 gap-y-4 border-y border-line py-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted">Customer</dt>
          <dd className="mt-1 break-words text-ink">
            {payment.customer.name || payment.customer.email || "Not provided"}
          </dd>
          {payment.customer.name && payment.customer.email ? (
            <dd className="break-all text-muted">{payment.customer.email}</dd>
          ) : null}
        </div>
        <div>
          <dt className="text-muted">Order reference</dt>
          <dd className="mt-1 break-words text-ink">{payment.reference || "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">Created</dt>
          <dd className="mt-1 text-ink">{new Date(payment.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-muted">Wallet</dt>
          <dd className="mt-1 text-ink">{settlementState(payment.settlementStatus)}</dd>
        </div>
      </dl>
      <section aria-labelledby="payment-received" className="flex flex-col gap-4">
        <h2 id="payment-received" className="font-semibold text-ink">
          Payment
        </h2>
        {used.map((option) => (
          <div key={option.optionId} className="flex flex-col gap-3 border-b border-line pb-5">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="font-medium text-ink">
                {payment.optionLocked || option.deposits.length ? (
                  <>
                    {option.symbol} · <NetworkName chainId={option.chainId} />
                  </>
                ) : (
                  "Awaiting customer payment"
                )}
              </span>
              <span className="text-muted">
                Received{" "}
                <span className="font-medium text-ink">
                  <PaymentReceived
                    payment={{
                      ...payment,
                      ...option,
                      receipts: (payment.receipts ?? []).filter(
                        (receipt) => receipt.optionId === option.optionId,
                      ),
                    }}
                  />
                </span>
              </span>
            </div>
            {BigInt(option.amounts.refunded) > 0n ? (
              <p className="text-sm text-muted">
                Refunded{" "}
                <PaymentAmount
                  amount={option.amounts.refunded}
                  decimals={option.decimals}
                  symbol={option.symbol}
                />
              </p>
            ) : null}
            {option.deposits[0] ? (
              <ExplorerLink chainId={option.chainId} txHash={option.deposits[0].txHash} named />
            ) : null}
          </div>
        ))}
      </section>
      <div className="flex flex-wrap items-center gap-3">
        {payment.hostedUrl ? (
          <a
            href={payment.hostedUrl}
            className={buttonClasses({ size: "sm", variant: "secondary" })}
          >
            {payment.paymentStatus === "paid"
              ? "View receipt"
              : payment.closed || payment.paymentStatus === "canceled"
                ? "View checkout"
                : "Open checkout"}
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
            className="text-sm text-info underline underline-offset-4"
          >
            View payment link
          </Link>
        ) : null}
        <p className="text-sm text-muted">
          {needsReview
            ? "Contact support before requesting another payment."
            : payment.refundStatus === "refunded"
              ? "Refund complete."
              : payment.paymentStatus === "canceled"
                ? "Payment canceled."
                : payment.paymentStatus === "paid"
                  ? "Customer payment complete."
                  : delayed
                    ? "Confirmation is delayed. Do not ask the customer to pay again."
                    : confirming
                      ? "Confirming payment. Do not ask the customer to pay again."
                      : payment.closed
                        ? "Checkout closed."
                        : payment.paymentStatus === "partially_paid"
                          ? "Share checkout for the remaining amount."
                          : "Share checkout with your customer."}
        </p>
      </div>
      <Accordion
        items={[
          {
            question: "Transactions",
            answer: <PaymentMovements profileId={profileId} paymentId={paymentId} />,
          },
          {
            question: "Technical details",
            answer: <PaymentDiagnostics profileId={profileId} paymentId={paymentId} />,
          },
        ]}
      />
    </div>
  );
}
