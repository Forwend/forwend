"use client";

import {
  Button,
  buttonClasses,
  COPY_STATUS,
  formatTokenAmount,
  PAYMENT_STATUS,
  Skeleton,
  StatusPill,
  shortAddress,
  useCopy,
} from "@forwend/ui-web";
import { Check, ChevronLeft, Copy, ExternalLink, FileDown } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId } from "react";
import {
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
} from "@/features/activity/constants/activity";
import {
  useGetInvoiceQuery,
  useGetProfileInvoiceQuery,
} from "@/features/invoices/api/invoices-api";
import { CheckStatus } from "@/features/invoices/components/check-status";
import { InvoiceAmount } from "@/features/invoices/components/invoice-amount";
import { InvoiceDeposits } from "@/features/invoices/components/invoice-deposits";
import { ConfirmingStatus, InvoiceTimeline } from "@/features/invoices/components/invoice-progress";
import { INVOICE_PDFS, INVOICE_STEPS } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY as COPY, REQUESTS_COPY } from "@/features/invoices/constants/invoices-copy";
import {
  exactDigits,
  formatDueDate,
  invoiceNumber,
  invoicePdfUrl,
  invoiceProgress,
  invoiceStatus,
  tokenKey,
} from "@/features/invoices/lib/invoices";
import type {
  Invoice,
  InvoicePdf,
  InvoiceSummary,
  InvoiceToken,
  SettlementWait,
} from "@/features/invoices/types/invoices";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { chainName } from "@/shared/lib/chains";

const NOT_FOUND = 404;
const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const CLOCK = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const COUNTRY = new Intl.DisplayNames(undefined, { type: "region" });
const PANEL = "rounded-md border border-line bg-surface";
const PANEL_TITLE = "border-b border-line px-4 py-3 text-base font-semibold text-ink sm:px-5";

export interface InvoiceDetailProps {
  invoiceId: string;
  profileId: string;
  tokens: readonly InvoiceToken[] | null;
  request?: boolean;
}

// The public read gives the terms, statuses and deposits and is read again every REFRESH_MS; the profile's own read
// gives the client once, and its 404 tells that this profile did not make the invoice. On desktop the header's
// breadcrumb leads back; phones have no breadcrumb, so they get a back link. A personal profile's invoice is a request:
// it has no client and no due date.
export function InvoiceDetail({
  invoiceId,
  profileId,
  tokens,
  request = false,
}: InvoiceDetailProps) {
  const invoice = useGetInvoiceQuery(invoiceId, LIVE_QUERY);
  // Polled like the public read: it carries why a paid invoice's money still waits, which changes as it settles.
  const owned = useGetProfileInvoiceQuery({ profileId, invoiceId }, LIVE_QUERY);
  const mine = owned.currentData ?? null;
  const failure = invoice.error as { status?: unknown } | undefined;
  const notMine = (owned.error as { status?: unknown } | undefined)?.status === NOT_FOUND;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={APP_ROUTES.invoices}
        className="-ml-1 inline-flex h-11 items-center gap-1 self-start rounded-sm px-1 text-sm text-muted hover:text-ink lg:hidden"
      >
        <ChevronLeft aria-hidden className="size-[var(--fw-icon-sm)]" />
        {request ? REQUESTS_COPY.invoices : COPY.back}
      </Link>
      {invoice.data ? (
        notMine ? (
          <p className="text-muted">{COPY.otherProfile}</p>
        ) : (
          <Loaded
            invoice={invoice.data}
            mine={mine}
            wait={owned.currentData?.settlementWait ?? null}
            clientFailed={owned.isError}
            tokens={tokens}
            request={request}
          />
        )
      ) : failure?.status === NOT_FOUND ? (
        <p className="text-muted">{COPY.notFound}</p>
      ) : invoice.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {COPY.failed}
          <Button size="sm" variant="secondary" onClick={invoice.refetch}>
            {COPY.retry}
          </Button>
        </div>
      ) : (
        <Skeleton className="h-64" />
      )}
    </div>
  );
}

function Loaded({
  invoice,
  mine,
  wait,
  clientFailed,
  tokens,
  request,
}: {
  invoice: Invoice;
  mine: InvoiceSummary | null;
  wait: SettlementWait | null;
  clientFailed: boolean;
  tokens: readonly InvoiceToken[] | null;
  request: boolean;
}) {
  const { current, blocksLeft, blocksTotal, secondsLeft } = invoiceProgress(invoice);
  const token =
    tokens?.find((t) => tokenKey(t) === tokenKey(invoice)) ??
    invoice.options.find((o) => o.optionId === invoice.optionId);
  const amount = BigInt(invoice.amount);
  const client = mine?.client;
  const issuer = invoice.issuer;
  // The API says open until the chain is final past expiry; the checkout closed at expiry.
  const closed = Date.parse(invoice.expiresAt) <= Date.now();
  const apiStatus = invoiceStatus(invoice);
  const status =
    closed && apiStatus === PAYMENT_STATUS.open
      ? PAYMENT_STATUS.expired
      : closed && apiStatus === PAYMENT_STATUS.partiallyPaid
        ? PAYMENT_STATUS.expiredPartiallyPaid
        : apiStatus;
  const received = invoice.deposits
    .filter((d) => !d.late)
    .reduce((sum, d) => sum + BigInt(d.amount), 0n);
  const money = (units: bigint) =>
    token
      ? `${formatTokenAmount({ baseUnits: units, decimals: token.decimals, fractionDigits: exactDigits(units, token.decimals) })} ${token.symbol}`
      : units.toString();
  // Payer chooses with no money yet: the amount is USD in any accepted option (R-56, D-75).
  const choosing = invoice.options.length > 1 && !invoice.optionLocked;
  // The pay link takes money only while these last; sharing it later only creates money held for a refund.
  const payable =
    !closed &&
    (
      [
        PAYMENT_STATUS.open,
        PAYMENT_STATUS.partiallyPaid,
        PAYMENT_STATUS.detected,
        PAYMENT_STATUS.confirming,
      ] as string[]
    ).includes(status);
  return (
    <>
      {/* One status, said at once: open with its close time, closed, partly paid, paid or settled (R-60). */}
      {/* The pay link is the page's action, so it sits with the status, while it can still take money (R-60). */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          {/* The number is the breadcrumb's last step on desktop, so the heading shows only on phones. */}
          <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
            {invoiceNumber(invoice.number)}
          </h1>
          {invoice.title ? (
            <p className="text-lg font-medium break-words text-ink">{invoice.title}</p>
          ) : null}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <StatusPill status={status} />
            {when(invoice) ? <span>{when(invoice)}</span> : null}
          </p>
        </div>
        {payable ? <ShareLink invoiceId={invoice.invoiceId} /> : null}
      </header>

      {/* minmax(0, 1fr): a long value never widens the column past the screen. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <section aria-labelledby="invoice-amount" className={PANEL}>
          <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:px-5">
            <h2 id="invoice-amount" className="text-sm text-muted">
              {COPY.amount}
            </h2>
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
              {token ? (
                <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-ink">
                  <span className="text-3xl font-semibold tracking-tight break-all sm:text-4xl">
                    {formatTokenAmount({
                      baseUnits: amount,
                      decimals: token.decimals,
                      fractionDigits: exactDigits(amount, token.decimals),
                    })}
                  </span>{" "}
                  <span className="text-lg font-medium text-muted">
                    {choosing ? COPY.usd : token.symbol}
                  </span>
                </p>
              ) : (
                <p className="min-w-0 text-ink">
                  <InvoiceAmount invoice={invoice} tokens={tokens} />
                </p>
              )}
              {received > 0n && received < amount && token ? (
                <p className="w-full text-sm text-muted sm:order-last">
                  {COPY.receivedOf(money(received), money(amount))}
                </p>
              ) : null}
              {choosing ? (
                <p className="text-sm text-muted">{COPY.clientChooses(invoice.options.length)}</p>
              ) : token ? (
                <TokenMark chainId={invoice.chainId} symbol={token.symbol} />
              ) : null}
            </div>
          </div>
          <div className="flex flex-col gap-3 px-4 py-5 sm:px-5">
            <InvoiceTimeline invoice={invoice} label={COPY.progress} />
            <p role="status" className="text-sm text-ink empty:sr-only">
              {current === INVOICE_STEPS.confirming ? (
                <ConfirmingStatus blocks={blocksLeft} total={blocksTotal} seconds={secondsLeft} />
              ) : // The badge and the timeline say the state; this line says only why money still waits.
              wait ? (
                COPY.settling[wait.kind](
                  chainName(invoice.chainId),
                  wait.secondsLeft ?? 0,
                  wait.until ? CLOCK.format(new Date(wait.until)) : "",
                )
              ) : null}
            </p>
            <InvoiceDeposits
              invoice={invoice}
              token={token ?? null}
              // The invoice's amount goes to the wallet; anything above it stays held for the payer (D-26).
              settlement={
                invoice.settlementTxHash
                  ? {
                      txHash: invoice.settlementTxHash,
                      to: invoice.recipient,
                      amount,
                      at: invoice.settledAt,
                    }
                  : null
              }
            />
            {/* Money sent to an option the client did not end up paying with is the payer's (D-76). */}
            {invoice.options
              .filter((o) => o.optionId !== invoice.optionId)
              .map((o) => (
                <InvoiceDeposits
                  key={o.optionId}
                  invoice={o}
                  token={o}
                  title={COPY.heldOn(o.symbol, chainName(o.chainId))}
                />
              ))}
            {/* Only while the checkout can take money: paid, settled or expired has nothing left to look for. */}
            {payable ? (
              <CheckStatus
                invoiceId={invoice.invoiceId}
                network={chainName(invoice.chainId)}
                money={money}
                nextCheckAt={invoice.nextCheckAt}
              />
            ) : null}
          </div>
        </section>

        <div className="flex flex-col gap-4">
          <section aria-labelledby="invoice-details" className={PANEL}>
            <h2 id="invoice-details" className={PANEL_TITLE}>
              {COPY.details}
            </h2>
            <dl className="divide-y divide-line">
              {invoice.dueDate ? (
                <Row term={COPY.dueDate}>{formatDueDate(invoice.dueDate)}</Row>
              ) : null}
              <Row term={COPY.expires}>{TIME.format(new Date(invoice.expiresAt))}</Row>
              <Row term={COPY.created}>{TIME.format(new Date(invoice.createdAt))}</Row>
              {invoice.note ? <Row term={COPY.note}>{invoice.note}</Row> : null}
              <Row term={COPY.pdfs}>
                <span className="flex flex-wrap gap-x-5 gap-y-1">
                  <PdfLink invoiceId={invoice.invoiceId} pdf={INVOICE_PDFS.invoice} />
                  {invoice.paymentStatus === API_PAYMENT_STATUSES.paid ? (
                    <PdfLink invoiceId={invoice.invoiceId} pdf={INVOICE_PDFS.receipt} />
                  ) : null}
                </span>
              </Row>
            </dl>
          </section>

          {request ? null : (
            <section aria-labelledby="invoice-client" className={PANEL}>
              <h2 id="invoice-client" className={PANEL_TITLE}>
                {COPY.client}
              </h2>
              {clientFailed ? (
                <p className="px-4 py-3 text-sm text-muted sm:px-5">{COPY.clientFailed}</p>
              ) : !mine ? (
                <Skeleton className="m-5 h-16" />
              ) : client?.name || client?.email || client?.address ? (
                <Party lines={[client.name, client.email, client.address]} />
              ) : (
                <p className="px-4 py-3 text-sm text-muted sm:px-5">{COPY.noClient}</p>
              )}
            </section>
          )}

          <section aria-labelledby="invoice-issuer" className={PANEL}>
            <h2 id="invoice-issuer" className={PANEL_TITLE}>
              {COPY.issuer}
            </h2>
            {issuer ? (
              <Party
                lines={[
                  issuer.name,
                  issuer.email,
                  issuer.address,
                  COUNTRY.of(issuer.country) ?? issuer.country,
                  issuer.taxId ? `${COPY.taxId} ${issuer.taxId}` : null,
                ]}
              />
            ) : invoice.senderName ? (
              <Party lines={[invoice.senderName]} />
            ) : (
              <p className="px-4 py-3 text-sm text-muted sm:px-5">
                {COPY.noIssuer}{" "}
                <Link href={APP_ROUTES.billingDetails} className="text-accent hover:underline">
                  {COPY.addBillingDetails}
                </Link>
              </p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

/**
 * When the invoice's status last changed or will: settled, paid, closed, or when its checkout closes. A paid invoice
 * never shows its checkout's close time, which would read as still open.
 */
function when(invoice: Invoice): string | null {
  if (invoice.settlementStatus === API_SETTLEMENT_STATUSES.settled)
    return invoice.settledAt ? COPY.settledOn(TIME.format(new Date(invoice.settledAt))) : null;
  if (invoice.paymentStatus === API_PAYMENT_STATUSES.paid)
    return invoice.paidAt ? COPY.paidOn(TIME.format(new Date(invoice.paidAt))) : null;
  const closes = TIME.format(new Date(invoice.expiresAt));
  return Date.parse(invoice.expiresAt) <= Date.now()
    ? COPY.closedOn(closes)
    : COPY.closesOn(closes);
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="px-4 py-3 sm:px-5">
      <dt className="text-xs text-muted">{term}</dt>
      <dd className="mt-0.5 text-sm break-words whitespace-pre-line text-ink">{children}</dd>
    </div>
  );
}

function PdfLink({ invoiceId, pdf }: { invoiceId: string; pdf: InvoicePdf }) {
  return (
    <a
      href={invoicePdfUrl(invoiceId, pdf)}
      className={`${buttonClasses({ variant: "link" })} gap-1.5 text-sm`}
    >
      <FileDown aria-hidden className="size-[var(--fw-icon-sm)]" />
      {COPY.pdf[pdf]}
    </a>
  );
}

function Party({ lines }: { lines: (string | null)[] }) {
  const [first, ...rest] = lines.filter(Boolean);
  return (
    <div className="px-4 py-3 text-sm break-words whitespace-pre-line sm:px-5">
      <p className="font-medium text-ink">{first}</p>
      {rest.map((line) => (
        <p key={line} className="mt-0.5 text-muted">
          {line}
        </p>
      ))}
    </div>
  );
}

/** The pay link in one row: the link (cut to fit, whole on hover and when copied), Copy and Open in a new tab. */
function ShareLink({ invoiceId }: { invoiceId: string }) {
  // The app renders only in the browser, after sign-in.
  const link = `${window.location.origin}/pay/${invoiceId}`;
  const [status, copy] = useCopy(link);
  const titleId = useId();
  const label =
    status === COPY_STATUS.copied
      ? COPY.copied
      : status === COPY_STATUS.failed
        ? COPY.copyFailed
        : COPY.copy;
  return (
    <section aria-labelledby={titleId} className="min-w-0 lg:w-[26rem] lg:shrink-0">
      <h2 id={titleId} className="sr-only">
        {COPY.share}
      </h2>
      <div className="flex items-center gap-2">
        {/* The host and a short id fit the row; Copy and Open use the whole link. */}
        <p
          title={link}
          className={`min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-3 py-1.5 font-mono text-sm text-ink ${status === COPY_STATUS.failed ? "break-all select-all" : "truncate"}`}
        >
          {status === COPY_STATUS.failed
            ? link
            : `${window.location.host}/pay/${shortAddress(invoiceId)}`}
        </p>
        <Button variant="secondary" size="sm" onClick={copy} className="shrink-0">
          {status === COPY_STATUS.copied ? (
            <Check aria-hidden className="size-[var(--fw-icon-sm)]" />
          ) : (
            <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
          )}
          {label}
        </Button>
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={COPY.openPayPage}
          title={COPY.openPayPage}
          className={`${buttonClasses({ variant: "secondary", size: "sm" })} shrink-0 px-2.5`}
        >
          <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
        </a>
      </div>
      <p role="status" className="sr-only">
        {status === COPY_STATUS.idle ? "" : label}
      </p>
    </section>
  );
}
