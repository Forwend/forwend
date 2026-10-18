"use client";

import {
  Button,
  buttonClasses,
  formatTokenAmount,
  PAYMENT_STATUS,
  Skeleton,
} from "@forwend/ui-web";
import { ChevronLeft, FileDown } from "lucide-react";
import Link from "next/link";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import { API_PAYMENT_STATUSES } from "@/features/activity/constants/activity";
import {
  useGetInvoiceQuery,
  useGetProfileInvoiceQuery,
} from "@/features/invoices/api/invoices-api";
import { CheckStatus } from "@/features/invoices/components/check-status";
import { InvoiceActions } from "@/features/invoices/components/invoice-actions";
import { InvoiceAmount } from "@/features/invoices/components/invoice-amount";
import { InvoiceDeposits } from "@/features/invoices/components/invoice-deposits";
import { InvoiceLines } from "@/features/invoices/components/invoice-lines";
import { ConfirmingStatus, InvoiceTimeline } from "@/features/invoices/components/invoice-progress";
import { PaymentReminders } from "@/features/invoices/components/payment-reminders";
import { RepeatsMonthly } from "@/features/invoices/components/repeats-monthly";
import { SendToClient } from "@/features/invoices/components/send-to-client";
import {
  INVOICE_EXCEPTIONS,
  INVOICE_PDFS,
  INVOICE_STEPS,
} from "@/features/invoices/constants/invoices";
import { INVOICE_COPY as COPY, REQUESTS_COPY } from "@/features/invoices/constants/invoices-copy";
import {
  formatAgreed,
  formatDueDate,
  invoiceCopyHref,
  invoiceException,
  invoiceNumber,
  invoicePdfUrl,
  invoiceProgress,
  invoiceStatus,
  tokenKey,
} from "@/features/invoices/lib/invoices";
import type {
  Invoice,
  InvoiceException,
  InvoicePdf,
  InvoiceReminders,
  InvoiceRetainer,
  InvoiceSend,
  InvoiceSummary,
  InvoiceToken,
  SettlementWait,
} from "@/features/invoices/types/invoices";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { Party } from "@/shared/components/party";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { chainName } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

const NOT_FOUND = 404;
const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const CLOCK = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const COUNTRY = new Intl.DisplayNames(undefined, { type: "region" });
const PANEL = "fw-panel";
const PANEL_TITLE = "fw-panel-head text-base font-semibold text-ink";

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
    <div className="flex flex-col gap-4 lg:gap-6">
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
            profileId={profileId}
            invoice={invoice.data}
            mine={mine}
            wait={owned.currentData?.settlementWait ?? null}
            sends={owned.currentData?.sends ?? []}
            reminders={owned.currentData?.reminders ?? null}
            retainer={owned.currentData?.retainer ?? null}
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
  profileId,
  invoice,
  mine,
  wait,
  sends,
  reminders,
  retainer,
  clientFailed,
  tokens,
  request,
}: {
  profileId: string;
  invoice: Invoice;
  mine: InvoiceSummary | null;
  wait: SettlementWait | null;
  sends: readonly InvoiceSend[];
  reminders: InvoiceReminders | null;
  retainer: InvoiceRetainer | null;
  clientFailed: boolean;
  tokens: readonly InvoiceToken[] | null;
  request: boolean;
}) {
  const { current, blocksLeft, blocksTotal, secondsLeft } = invoiceProgress(invoice);
  const token =
    tokens?.find((t) => tokenKey(t) === tokenKey(invoice)) ??
    invoice.options.find((o) => o.optionId === invoice.optionId);
  const amount = BigInt(invoice.amount);
  // Lines are in the base units of the invoice's own option, whichever option the payer locked (R-88).
  const main = invoice.options.find((o) => o.optionId === invoice.invoiceId);
  const client = mine?.client;
  const issuer = invoice.issuer;
  // The checkout closes at expiry by the local clock (pay link, Checkout closed in Details); the status follows the
  // API's closed flag, at most one poll later.
  const closed = Date.parse(invoice.expiresAt) <= Date.now();
  const status = invoiceStatus(invoice);
  const exception = invoiceException(invoice, status);
  const received = exception.received;
  const money = (units: bigint) =>
    token
      ? `${formatTokenAmount({ baseUnits: units, decimals: token.decimals, fractionDigits: exactDigits(units, token.decimals) })} ${token.symbol}`
      : units.toString();
  // Payer chooses with no money yet: the amount is USD in any accepted option (R-56, D-75).
  const choosing = invoice.options.length > 1 && !invoice.optionLocked;
  // The pay link takes money only while these last; sharing it later only creates money held for a refund.
  const canceledRow = useRef<HTMLDivElement>(null);
  // Focus waits for Details' Canceled on row to render: until the dialog is gone everything else is inert.
  const [canceling, setCanceling] = useState(false);
  const canceled = invoice.paymentStatus === API_PAYMENT_STATUSES.canceled;
  useEffect(() => {
    if (canceling && canceled) canceledRow.current?.focus();
  }, [canceling, canceled]);
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
      {/* Each thing said once (R-60): the timeline says the status and Details the times (when the checkout closes,
          when it was canceled), so the header only names the invoice. Its actions (copy and open the pay link while it
          takes money, duplicate it, cancel before any money) wait behind one More actions menu at the header's top
          right. */}
      <header className="flex items-start justify-between gap-3 lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* Above a title the number is a quiet label on phones, so the title reads as the heading; on desktop the
              breadcrumb's last step already shows it. With no title the number is the heading everywhere. */}
          <h1
            className={`flex min-h-7 items-center ${invoice.title ? "text-sm font-medium text-muted lg:sr-only" : "text-2xl font-semibold tracking-tight text-ink"}`}
          >
            {invoiceNumber(invoice.number)}
          </h1>
          {invoice.title ? (
            <p className="text-2xl font-semibold tracking-tight break-words text-ink">
              {invoice.title}
            </p>
          ) : null}
          <NextStep
            invoiceId={invoice.invoiceId}
            exception={exception}
            money={money}
            request={request}
          />
        </div>
        <InvoiceActions
          profileId={profileId}
          invoiceId={invoice.invoiceId}
          number={invoiceNumber(invoice.number)}
          noun={request ? COPY.noun.request : COPY.noun.invoice}
          payable={payable}
          // Only before any money, on any option (R-79): after that the money decides, not a cancel.
          cancelable={
            payable &&
            status === PAYMENT_STATUS.open &&
            invoice.deposits.length === 0 &&
            invoice.options.every((o) => o.deposits.length === 0)
          }
          onCanceled={() => setCanceling(true)}
        />
      </header>

      {/* minmax(0, 1fr): a long value never widens the column past the screen. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <div className="flex min-w-0 flex-col gap-4">
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
                      {choosing ? MONEY_COPY.usd : token.symbol}
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
                ) : // The timeline says the state; this line says only why money still waits.
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
          {main && invoice.lines.length > 0 ? (
            <InvoiceLines
              lines={invoice.lines}
              decimals={main.decimals}
              unit={invoice.options.length > 1 ? MONEY_COPY.usd : main.symbol}
              total={BigInt(main.amount)}
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <section aria-labelledby="invoice-details" className={PANEL}>
            <h2 id="invoice-details" className={PANEL_TITLE}>
              {COPY.details}
            </h2>
            <dl className="divide-y divide-line">
              {invoice.reference ? <Row term={COPY.reference}>{invoice.reference}</Row> : null}
              {invoice.dueDate ? (
                <Row term={COPY.dueDate}>{formatDueDate(invoice.dueDate)}</Row>
              ) : null}
              <Row term={closed ? COPY.closed : COPY.expires}>
                {TIME.format(new Date(invoice.expiresAt))}
              </Row>
              <Row term={COPY.created}>{TIME.format(new Date(invoice.createdAt))}</Row>
              {invoice.supplyDate ? (
                <Row term={COPY.supplyDate}>{formatDueDate(invoice.supplyDate)}</Row>
              ) : null}
              {invoice.agreedValue ? (
                <Row term={COPY.agreedValue}>
                  {COPY.agreedOn(
                    formatAgreed(invoice.agreedValue),
                    formatDueDate(invoice.agreedValue.date),
                  )}
                </Row>
              ) : null}
              {invoice.canceledAt ? (
                <Row term={COPY.canceledOn} ref={canceledRow}>
                  {TIME.format(new Date(invoice.canceledAt))}
                </Row>
              ) : null}
              {invoice.note ? (
                <Row term={COPY.note} stacked>
                  {invoice.note}
                </Row>
              ) : null}
              <Row term={COPY.pdfs}>
                <span className="flex flex-wrap justify-end gap-x-5 gap-y-1">
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
              ) : client?.name ||
                client?.email ||
                client?.address ||
                client?.country ||
                client?.taxId ? (
                <Party
                  lines={[
                    client.name,
                    client.email,
                    client.address,
                    client.country ? (COUNTRY.of(client.country) ?? client.country) : null,
                    client.taxId ? `${COPY.taxId} ${client.taxId}` : null,
                  ]}
                />
              ) : (
                <p className="px-4 py-3 text-sm text-muted sm:px-5">{COPY.noClient}</p>
              )}
              {mine ? (
                <SendToClient
                  profileId={profileId}
                  invoiceId={invoice.invoiceId}
                  number={invoiceNumber(invoice.number)}
                  email={client?.email ?? null}
                  sends={sends}
                  payable={payable}
                />
              ) : null}
              {/* Reminders go to the client's email, so they show only with one (R-96). */}
              {client?.email && reminders ? (
                <PaymentReminders
                  profileId={profileId}
                  invoiceId={invoice.invoiceId}
                  reminders={reminders}
                  hasDueDate={!!invoice.dueDate}
                  payable={payable}
                />
              ) : null}
              {retainer ? (
                <RepeatsMonthly
                  profileId={profileId}
                  invoiceId={invoice.invoiceId}
                  retainer={retainer}
                />
              ) : null}
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
 * What happened and what to do next, under the status (R-77): what is left while partly paid; a new invoice once the
 * checkout closed, never the old one reopened (D-25); and money after the close, which is held for the payer (D-26).
 */
function NextStep({
  invoiceId,
  exception,
  money,
  request,
}: {
  invoiceId: string;
  exception: InvoiceException;
  money: (units: bigint) => string;
  request: boolean;
}) {
  const noun = request ? COPY.noun.request : COPY.noun.invoice;
  const { received, left, late } = exception;
  // Canceled with nothing sent needs no line: Details says when it was canceled.
  const kind =
    exception.kind === INVOICE_EXCEPTIONS.canceled && received === 0n ? null : exception.kind;
  if (!kind && late === 0n) return null;
  return (
    <div className="flex flex-col items-start gap-2 text-sm text-ink">
      {kind ? <p>{COPY.next[kind]({ left: money(left), held: money(received), noun })}</p> : null}
      {late > 0n ? <p>{COPY.lateHeld(money(late))}</p> : null}
      {kind === INVOICE_EXCEPTIONS.closedUnpaid || kind === INVOICE_EXCEPTIONS.closedPartial ? (
        <Link
          href={invoiceCopyHref(invoiceId, kind === INVOICE_EXCEPTIONS.closedPartial)}
          className={buttonClasses({ variant: "secondary", size: "sm" })}
        >
          {kind === INVOICE_EXCEPTIONS.closedPartial
            ? COPY.newForRest(noun)
            : request
              ? COPY.newRequest
              : COPY.newInvoice}
        </Link>
      ) : null}
    </div>
  );
}

// A term and its value on one line, as a statement reads; free text (a note) stacks under its term instead. A row
// given a ref can take focus from script (Canceled on, after a cancel).
function Row({
  term,
  stacked = false,
  children,
  ref,
}: {
  term: string;
  stacked?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) {
  return stacked ? (
    <div className="px-4 py-3 sm:px-5">
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="mt-1 text-sm break-words whitespace-pre-line text-ink">{children}</dd>
    </div>
  ) : (
    <div
      ref={ref}
      tabIndex={ref ? -1 : undefined}
      className="flex items-baseline justify-between gap-4 px-4 py-3 outline-none sm:px-5"
    >
      <dt className="shrink-0 text-sm text-muted">{term}</dt>
      <dd className="min-w-0 text-right text-sm break-words text-ink">{children}</dd>
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
