"use client";
import {
  Badge,
  buttonClasses,
  DetailList,
  DetailRow,
  Skeleton,
  StatusPill,
  WalletStateLabel,
} from "@forwend/ui-web";
import { ExternalLink, FileDown } from "lucide-react";
import { type ReactNode, useId } from "react";
import { InvoiceLines } from "@/features/invoices/components/invoice-lines";
import { invoiceNumber, invoicePdfUrl } from "@/features/invoices/lib/invoices";
import { useGetPaymentQuery } from "@/features/payments/api/payments-api";
import { Disclosure } from "@/features/payments/components/disclosure";
import { ExportPayments } from "@/features/payments/components/export-payments";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { PaymentDiagnostics } from "@/features/payments/components/payment-diagnostics";
import { PaymentMovements } from "@/features/payments/components/payment-movements";
import { PaymentProblems } from "@/features/payments/components/payment-problems";
import { PaymentProgress } from "@/features/payments/components/payment-progress";
import { PaymentReceived } from "@/features/payments/components/payment-received";
import { SOURCE_LABELS } from "@/features/payments/constants/payments";
import { PAYMENT_DETAIL_COPY as COPY } from "@/features/payments/constants/payments-copy";
import {
  nextStep,
  paymentDisplayStatus,
  paymentLabel,
  paymentWallet,
} from "@/features/payments/lib/payments";
import type { PaymentDetail as PaymentDetailType } from "@/features/payments/types/payments";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { NetworkName } from "@/shared/components/chains/network-name";
import { DetailHeader } from "@/shared/components/detail-header";
import { LoadError } from "@/shared/components/load-error";
import { RecordLink } from "@/shared/components/record-link";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { dateTime } from "@/shared/lib/dates";

export interface PaymentDetailProps {
  profileId: string;
  paymentId: string;
}

// The routine wait is the status itself; only real problems get their own panel.
const ROUTINE = new Set(["verification_pending", "partial_payment"]);

export function PaymentDetail({ profileId, paymentId }: PaymentDetailProps) {
  const read = useGetPaymentQuery({ profileId, paymentId }, LIVE_QUERY);
  const payment = read.currentData;
  if (!payment)
    return read.isError ? (
      <LoadError
        message={COPY.unavailable}
        onRetry={() => void read.refetch()}
        retrying={read.isFetching}
      />
    ) : (
      <DetailSkeleton />
    );
  const funded = payment.options.filter(
    (option) =>
      option.deposits.length > 0 || (payment.optionLocked && option.optionId === payment.optionId),
  );
  const used = funded.length
    ? funded
    : payment.options.filter((option) => option.optionId === payment.optionId);
  const problems = payment.problems.filter(
    (problem) =>
      !ROUTINE.has(problem.code) &&
      !(
        problem.action === "wait" &&
        (problem.code === "outflow_unreconciled" || problem.code === "settlement_delayed")
      ),
  );
  const status = paymentDisplayStatus(payment);
  const payToken = payment.hostedUrl ? new URL(payment.hostedUrl).pathname.split("/").pop() : null;
  const chosen = payment.options.find((option) => option.optionId === payment.optionId);
  // Items are in the base units of the option whose id is the payment's.
  const main = payment.options.find((option) => option.optionId === payment.paymentId);
  return (
    <div className="flex flex-col gap-5">
      <DetailHeader
        back={{ href: APP_ROUTES.payments, label: COPY.back }}
        title={paymentLabel(payment)}
        badges={payment.livemode ? null : <Badge tone="warning">{COPY.testnet}</Badge>}
        meta={
          <>
            {SOURCE_LABELS[payment.source]}
            {payment.storeName ? ` · ${payment.storeName}` : ""} · {dateTime(payment.createdAt)}
          </>
        }
        actions={
          <>
            {payment.hostedUrl ? (
              <a
                href={`${payment.hostedUrl}?preview=1`}
                target="_blank"
                rel="noopener"
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                {payment.paymentStatus === "paid" ? COPY.viewReceipt : COPY.viewCheckout}
                <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
              </a>
            ) : null}
            <ExportPayments profileId={profileId} paymentId={paymentId} />
          </>
        }
        summary={
          <>
            <span className="text-3xl font-medium tracking-tight text-ink tabular-nums">
              <PaymentAmount
                amount={payment.amount}
                decimals={payment.decimals}
                symbol={payment.optionCount > 1 ? "USD" : payment.symbol}
              />
            </span>
            <StatusPill status={status} />
            {paymentWallet(payment) === "none" ? null : (
              <WalletStateLabel state={paymentWallet(payment)} />
            )}
          </>
        }
        next={nextStep(payment)}
      />
      {read.isError ? (
        <LoadError
          inline
          message={COPY.stale}
          onRetry={() => void read.refetch()}
          retrying={read.isFetching}
        />
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)] xl:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          {problems.length ? (
            <Panel title={COPY.problems}>
              <div className="px-4 py-3 sm:px-5">
                <PaymentProblems problems={problems} hostedUrl={payment.hostedUrl} />
              </div>
            </Panel>
          ) : null}
          <Panel title={COPY.received}>
            <ul className="divide-y divide-line">
              {used.map((option) => (
                <li key={option.optionId} className="flex flex-col gap-3 px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium text-ink">
                      {payment.optionLocked ||
                      payment.optionCount === 1 ||
                      option.deposits.length ? (
                        <>
                          {option.symbol} · <NetworkName chainId={option.chainId} />
                        </>
                      ) : (
                        COPY.noTokenYet
                      )}
                    </span>
                    {option.deposits.length === 0 ? (
                      <span className="text-muted">{COPY.nothingYet}</span>
                    ) : (
                      <span className="text-muted">
                        {COPY.receivedOf}{" "}
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
                    )}
                  </div>
                  <FinalDeposits
                    deposits={option.deposits.filter((d) => d.status !== "detected")}
                    option={option}
                  />
                  {BigInt(option.amounts.refunded) > 0n ? (
                    <p className="text-sm text-muted">
                      {COPY.returned}{" "}
                      <PaymentAmount
                        amount={option.amounts.refunded}
                        decimals={option.decimals}
                        symbol={option.symbol}
                      />
                    </p>
                  ) : null}
                  <PaymentProgress option={option} />
                </li>
              ))}
            </ul>
          </Panel>
          {payment.items?.length && main ? (
            <InvoiceLines
              lines={payment.items}
              decimals={main.decimals}
              unit={payment.optionCount > 1 ? MONEY_COPY.usd : main.symbol}
              total={BigInt(main.amount)}
            />
          ) : null}
          <Disclosure title={COPY.transactions}>
            <PaymentMovements profileId={profileId} paymentId={paymentId} />
          </Disclosure>
          <Disclosure title={COPY.technical}>
            <PaymentDiagnostics profileId={profileId} paymentId={paymentId} />
          </Disclosure>
        </div>
        <Panel title={COPY.details}>
          <DetailList>
            {payment.reference ? (
              <DetailRow term={COPY.reference}>{payment.reference}</DetailRow>
            ) : null}
            {payment.documentKind !== "none" && payment.number ? (
              <DetailRow term={payment.documentKind === "request" ? COPY.request : COPY.invoice}>
                <RecordLink href={`${APP_ROUTES.invoices}/${payment.paymentId}`}>
                  {invoiceNumber(payment.number)}
                </RecordLink>
              </DetailRow>
            ) : null}
            {payment.linkId ? (
              <DetailRow term={COPY.link}>
                <RecordLink href={`${APP_ROUTES.links}/${payment.linkId}`}>
                  {payment.title ?? COPY.viewLink}
                </RecordLink>
              </DetailRow>
            ) : null}
            {payment.storeId ? (
              <DetailRow term={COPY.store}>
                <RecordLink href={`${APP_ROUTES.payments}?storeId=${payment.storeId}`}>
                  {payment.storeName ?? COPY.store}
                </RecordLink>
              </DetailRow>
            ) : null}
            <DetailRow term={COPY.customer}>
              {payment.customer.name || payment.customer.email || (
                <span className="text-subtle">{COPY.noCustomer}</span>
              )}
              {payment.customer.name && payment.customer.email ? (
                <span className="block break-all text-muted">{payment.customer.email}</span>
              ) : null}
            </DetailRow>
            {chosen && (payment.optionLocked || payment.optionCount === 1) ? (
              <DetailRow term={COPY.paidWith}>
                {chosen.symbol} · <NetworkName chainId={chosen.chainId} />
              </DetailRow>
            ) : (
              <DetailRow term={COPY.accepts}>{COPY.options(payment.optionCount)}</DetailRow>
            )}
            <DetailRow term={payment.closed ? COPY.closed : COPY.closes}>
              {dateTime(payment.closesAt)}
            </DetailRow>
            {Object.entries(payment.metadata).map(([key, value]) => (
              <DetailRow key={key} term={key}>
                <span className="font-mono text-xs">{value}</span>
              </DetailRow>
            ))}
            {payToken ? (
              <DetailRow term={COPY.documents}>
                <span className="flex flex-col items-end gap-1">
                  {payment.documentKind !== "none" ? (
                    <PdfLink href={invoicePdfUrl(payToken, "invoice")}>{COPY.invoicePdf}</PdfLink>
                  ) : null}
                  {payment.paymentStatus === "paid" ? (
                    <PdfLink href={invoicePdfUrl(payToken, "receipt")}>{COPY.receiptPdf}</PdfLink>
                  ) : null}
                  {payment.documentKind === "none" && payment.paymentStatus !== "paid" ? (
                    <span className="text-subtle">{COPY.noDocuments}</span>
                  ) : null}
                </span>
              </DetailRow>
            ) : null}
          </DetailList>
        </Panel>
      </div>
    </div>
  );
}

type Option = PaymentDetailType["options"][number];

/** Final deposits with their time and transaction. One deposit is the received amount above, so it adds no second
 * amount; several list each part. Confirming deposits show with their progress instead. */
function FinalDeposits({ deposits, option }: { deposits: Option["deposits"]; option: Option }) {
  const [only] = deposits;
  if (!only) return null;
  if (deposits.length === 1)
    return (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        {dateTime(only.blockTime)}
        {only.late ? <span>{COPY.late}</span> : null}
        <ExplorerLink chainId={option.chainId} txHash={only.txHash} />
      </p>
    );
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {deposits.map((deposit) => (
        <li
          key={`${deposit.txHash}:${deposit.logIndex}`}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
        >
          <span className="text-ink tabular-nums">
            <PaymentAmount
              amount={deposit.amount}
              decimals={option.decimals}
              symbol={option.symbol}
            />
            {deposit.late ? <span className="text-muted"> · {COPY.late}</span> : null}
          </span>
          <span className="flex items-center gap-3 text-muted">
            {dateTime(deposit.blockTime)}
            <ExplorerLink chainId={option.chainId} txHash={deposit.txHash} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="fw-panel">
      <h2 id={id} className="fw-panel-head text-sm font-medium text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A panel whose content loads only once opened, so routine visits never read the ledger. */

function PdfLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1.5 text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
    >
      <FileDown aria-hidden className="size-[var(--fw-icon-sm)]" />
      {children}
    </a>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-5">
      <span className="sr-only" role="status">
        {COPY.loading}
      </span>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-11 w-full" />
      <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
        <Skeleton className="h-48" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
