"use client";

import {
  Button,
  buttonClasses,
  formatTokenAmount,
  PAYMENT_STATUS,
  Skeleton,
  StatusPill,
} from "@forwend/ui-web";
import { ChevronLeft, FileDown } from "lucide-react";
import Link from "next/link";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import { API_PAYMENT_STATUSES } from "@/features/activity/constants/activity";
import { useGetProfileInvoiceQuery } from "@/features/invoices/api/invoices-api";
import { InvoiceActions } from "@/features/invoices/components/invoice-actions";
import { InvoiceAmount } from "@/features/invoices/components/invoice-amount";
import { InvoiceHistory } from "@/features/invoices/components/invoice-history";
import { InvoiceLines } from "@/features/invoices/components/invoice-lines";
import { ConfirmingStatus } from "@/features/invoices/components/invoice-progress";
import { PaymentAmountsNotice } from "@/features/invoices/components/payment-amounts-notice";
import { PaymentReminders } from "@/features/invoices/components/payment-reminders";
import { ReopenInvoice } from "@/features/invoices/components/reopen-invoice";
import { RepeatsMonthly } from "@/features/invoices/components/repeats-monthly";
import { SendToClient } from "@/features/invoices/components/send-to-client";
import { INVOICE_EXCEPTIONS, INVOICE_PDFS } from "@/features/invoices/constants/invoices";
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
  InvoiceHistoryEvent,
  InvoicePdf,
  InvoiceReminders,
  InvoiceRetainer,
  InvoiceSend,
  InvoiceSummary,
  InvoiceToken,
  InvoiceViews,
  Revision,
} from "@/features/invoices/types/invoices";
import { settlementState } from "@/features/payments/lib/payments";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { Party } from "@/shared/components/party";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { exactDigits } from "@/shared/lib/money";

const NOT_FOUND = 404;
const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const COUNTRY = new Intl.DisplayNames(undefined, { type: "region" });
const PANEL = "fw-panel";
const PANEL_TITLE = "fw-panel-head text-base font-semibold text-ink";

export interface InvoiceDetailProps {
  invoiceId: string;
  profileId: string;
  tokens: readonly InvoiceToken[] | null;
  request?: boolean;
}

// A 404 means another profile made the invoice (the public read needs the pay token, D-86).
// A personal profile's invoice is a request: it has no client and no due date.
export function InvoiceDetail({
  invoiceId,
  profileId,
  tokens,
  request = false,
}: InvoiceDetailProps) {
  const invoice = useGetProfileInvoiceQuery({ profileId, invoiceId, summary: true }, LIVE_QUERY);
  const mine = invoice.currentData ?? null;
  const failure = invoice.error as { status?: unknown } | undefined;

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
        <Loaded
          profileId={profileId}
          invoice={invoice.data}
          mine={mine}
          sends={mine?.sends ?? []}
          reminders={mine?.reminders ?? null}
          retainer={mine?.retainer ?? null}
          history={mine?.history ?? []}
          views={mine?.views ?? null}
          clientFailed={invoice.isError}
          tokens={tokens}
          request={request}
        />
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
  sends,
  reminders,
  retainer,
  history,
  views,
  clientFailed,
  tokens,
  request,
}: {
  profileId: string;
  invoice: Invoice;
  mine: InvoiceSummary | null;
  sends: readonly InvoiceSend[];
  reminders: InvoiceReminders | null;
  retainer: InvoiceRetainer | null;
  history: readonly InvoiceHistoryEvent[];
  views: InvoiceViews | null;
  clientFailed: boolean;
  tokens: readonly InvoiceToken[] | null;
  request: boolean;
}) {
  const token =
    tokens?.find((t) => tokenKey(t) === tokenKey(invoice)) ??
    invoice.options.find((o) => o.optionId === invoice.optionId);
  const amount = BigInt(invoice.amount);
  // Lines are in the base units of the invoice's own option, whichever option the payer locked (R-88).
  const main = invoice.options.find((o) => o.optionId === invoice.invoiceId);
  const client = mine?.client;
  const issuer = invoice.issuer;
  // By the local clock; the status follows the API's closed flag, at most one poll later.
  const closed = Date.parse(invoice.closesAt) <= Date.now();
  const status = invoiceStatus(invoice);
  const { blocksLeft, blocksTotal, secondsLeft } = invoiceProgress(invoice);
  const exception = invoiceException(invoice, status);
  const received = exception.received;
  const money = (units: bigint) =>
    token
      ? `${formatTokenAmount({ baseUnits: units, decimals: token.decimals, fractionDigits: exactDigits(units, token.decimals) })} ${token.symbol}`
      : units.toString();
  // Payer chooses with no money yet: the amount is USD in any accepted option (R-56, D-75).
  const choosing = invoice.optionCount > 1 && !invoice.optionLocked;
  const canceledRow = useRef<HTMLDivElement>(null);
  // Focus waits for Details' Canceled on row to render: until the dialog is gone everything else is inert.
  const [canceling, setCanceling] = useState(false);
  const canceled = invoice.paymentStatus === API_PAYMENT_STATUSES.canceled;
  useEffect(() => {
    if (canceling && canceled) canceledRow.current?.focus();
  }, [canceling, canceled]);
  // Reopen (R-130) works the same way: focus goes to Details' new close once it shows.
  const closesRow = useRef<HTMLDivElement>(null);
  const [reopening, setReopening] = useState(false);
  const reopened = Date.parse(invoice.closesAt) > Date.parse(invoice.expiresAt);
  useEffect(() => {
    if (reopening && reopened) closesRow.current?.focus();
  }, [reopening, reopened]);
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
  // Only before any money, on any option: cancel (R-79) and the edits the payer sees (R-128).
  const beforePayment =
    payable &&
    status === PAYMENT_STATUS.open &&
    invoice.deposits.length === 0 &&
    invoice.options.every((o) => o.deposits.length === 0);
  return (
    <>
      {/* R-60: each thing is said once, so the header only names the invoice. */}
      <header className="flex items-start justify-between gap-3 lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* With a title, the number is a quiet label; on desktop the breadcrumb shows it. */}
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
          {/* R-143: testnet money must never pass for real money. */}
          {invoice.livemode ? null : (
            <div className="flex">
              <span className="text-xs text-warning">Testnet</span>
            </div>
          )}
          <NextStep
            profileId={profileId}
            invoiceId={invoice.invoiceId}
            number={invoiceNumber(invoice.number)}
            exception={exception}
            money={money}
            request={request}
            reopenUntil={invoice.reopenUntil ?? null}
            closing={Boolean(
              invoice.closed && invoice.amounts && BigInt(invoice.amounts.payable) > 0n,
            )}
            needsReview={Boolean(
              invoice.amounts?.unreconciled || invoice.amounts?.hasPolicyException,
            )}
            onReopened={() => setReopening(true)}
          />
        </div>
        <InvoiceActions
          profileId={profileId}
          invoiceId={invoice.invoiceId}
          payToken={invoice.payToken}
          number={invoiceNumber(invoice.number)}
          noun={request ? COPY.noun.request : COPY.noun.invoice}
          payable={payable}
          // Only before any money, on any option (R-79): after that the money decides, not a cancel.
          cancelable={beforePayment}
          onCanceled={() => setCanceling(true)}
          editable={
            mine
              ? {
                  memo: invoice.memo ?? null,
                  clientEmail: client?.email ?? null,
                  returnUrl: invoice.returnUrl,
                  reference: invoice.reference,
                  note: invoice.note,
                  dueDate: invoice.dueDate,
                  beforePayment,
                  closesOn: invoice.expiresAt.slice(0, 10),
                  today: new Date().toISOString().slice(0, 10),
                  request,
                }
              : null
          }
        />
      </header>
      <PaymentAmountsNotice
        options={invoice.options}
        detailsHref={`${APP_ROUTES.payments}/${invoice.invoiceId}`}
      />

      {/* minmax(0, 1fr): a long value never widens the column past the screen. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <div className="@container flex min-w-0 flex-col gap-4">
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
                  <p className="text-sm text-muted">{COPY.clientChooses(invoice.optionCount)}</p>
                ) : token ? (
                  <TokenMark chainId={invoice.chainId} symbol={token.symbol} />
                ) : null}
              </div>
            </div>
            <div className="flex flex-col gap-3 px-4 py-5 sm:px-5">
              <div className="flex flex-wrap items-center gap-3">
                {status === PAYMENT_STATUS.confirming ? (
                  <span role="status" aria-label="Payment confirmation">
                    <ConfirmingStatus
                      blocks={blocksLeft}
                      total={blocksTotal}
                      seconds={secondsLeft}
                    />
                  </span>
                ) : (
                  <StatusPill status={status} />
                )}
                {invoice.settlementStatus !== "none" ? (
                  <span className="text-sm text-muted">
                    {settlementState(invoice.settlementStatus)}
                  </span>
                ) : null}
                <Link
                  href={`${APP_ROUTES.payments}/${invoice.invoiceId}`}
                  className="text-sm text-info underline underline-offset-4"
                >
                  View payment
                </Link>
              </div>
            </div>
          </section>
          {main && invoice.lines.length > 0 ? (
            <InvoiceLines
              lines={invoice.lines}
              decimals={main.decimals}
              unit={invoice.optionCount > 1 ? MONEY_COPY.usd : main.symbol}
              total={BigInt(main.amount)}
            />
          ) : null}
          <div className="grid gap-4 @xl:grid-cols-2 *:only:col-span-full">
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
                {/* Reminders go to the client's email (R-96): shown with one, or while on so they can be turned off. */}
                {(client?.email || reminders?.on) && reminders ? (
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
          <InvoiceHistory invoice={invoice} history={history} views={views} />
        </div>

        <div className="flex flex-col gap-4">
          <section aria-labelledby="invoice-details" className={PANEL}>
            <h2 id="invoice-details" className={PANEL_TITLE}>
              {COPY.details}
            </h2>
            <dl className="divide-y divide-line">
              {invoice.store ? (
                <Row term={COPY.store}>
                  <Link
                    href={`${APP_ROUTES.stores}/${invoice.store.storeId}`}
                    className="text-accent hover:underline"
                  >
                    {invoice.store.name}
                  </Link>
                </Row>
              ) : null}
              {invoice.reference ? <Row term={COPY.reference}>{invoice.reference}</Row> : null}
              {invoice.dueDate ? (
                <Row term={COPY.dueDate}>{formatDueDate(invoice.dueDate)}</Row>
              ) : null}
              {/* Focusable only for the reopen that moves focus here. */}
              <Row
                term={closed ? COPY.closed : COPY.expires}
                ref={reopening ? closesRow : undefined}
              >
                {TIME.format(new Date(invoice.closesAt))}
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
              {invoice.replacedBy ? (
                <Row term={COPY.replacedBy}>
                  <RevisionLink revision={invoice.replacedBy} />
                </Row>
              ) : null}
              {invoice.replaces ? (
                <Row term={COPY.replaces}>
                  <RevisionLink revision={invoice.replaces} />
                </Row>
              ) : null}
              {invoice.note ? (
                <Row term={COPY.note} stacked>
                  {invoice.note}
                </Row>
              ) : null}
              {invoice.memo ? (
                <Row term={COPY.memo} stacked>
                  {invoice.memo}
                </Row>
              ) : null}
              <Row term={COPY.pdfs}>
                <span className="flex flex-wrap justify-end gap-x-5 gap-y-1">
                  <PdfLink payToken={invoice.payToken} pdf={INVOICE_PDFS.invoice} />
                  {invoice.paymentStatus === API_PAYMENT_STATUSES.paid ? (
                    <PdfLink payToken={invoice.payToken} pdf={INVOICE_PDFS.receipt} />
                  ) : null}
                </span>
              </Row>
            </dl>
          </section>
        </div>
      </div>
    </>
  );
}

/** Under the status (R-77): a new invoice after the close, or once, a partly paid one reopened (R-130, D-25). */
function NextStep({
  profileId,
  invoiceId,
  number,
  exception,
  money,
  request,
  reopenUntil,
  needsReview,
  closing,
  onReopened,
}: {
  profileId: string;
  invoiceId: string;
  number: string;
  exception: InvoiceException;
  money: (units: bigint) => string;
  request: boolean;
  reopenUntil: string | null;
  needsReview: boolean;
  closing: boolean;
  onReopened: () => void;
}) {
  const noun = request ? COPY.noun.request : COPY.noun.invoice;
  const { received, left, late } = exception;
  // Canceled with nothing sent needs no line: Details says when it was canceled.
  const kind =
    exception.kind === INVOICE_EXCEPTIONS.canceled && received === 0n ? null : exception.kind;
  if (needsReview || (!kind && late === 0n)) return null;
  if (closing) return <p className="text-sm text-ink">{COPY.checkingClosed}</p>;
  const reopen = kind === INVOICE_EXCEPTIONS.closedPartial ? reopenUntil : null;
  const values = { left: money(left), held: money(received), noun };
  return (
    <div className="flex flex-col items-start gap-2 text-sm text-ink">
      {kind ? <p>{reopen ? COPY.nextReopen(values) : COPY.next[kind](values)}</p> : null}
      {late > 0n ? <p>{COPY.lateHeld(money(late))}</p> : null}
      {kind === INVOICE_EXCEPTIONS.closedUnpaid || kind === INVOICE_EXCEPTIONS.closedPartial ? (
        <div className="flex flex-wrap gap-2">
          {reopen ? (
            <ReopenInvoice
              profileId={profileId}
              invoiceId={invoiceId}
              number={number}
              noun={noun}
              until={reopen}
              onReopened={onReopened}
            />
          ) : null}
          <Link
            href={invoiceCopyHref(invoiceId, false)}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            {request ? COPY.newRequest : COPY.newInvoice}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

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

// An invoice made before D-86 has no pay link, so its PDFs can't be fetched.
function PdfLink({ payToken, pdf }: { payToken: string | null; pdf: InvoicePdf }) {
  if (!payToken) return null;
  return (
    <a
      href={invoicePdfUrl(payToken, pdf)}
      className={`${buttonClasses({ variant: "link" })} gap-1.5 text-sm`}
    >
      <FileDown aria-hidden className="size-[var(--fw-icon-sm)]" />
      {COPY.pdf[pdf]}
    </a>
  );
}

/** R-129: the other invoice of a Revise, on the owner's page. */
function RevisionLink({ revision }: { revision: Revision }) {
  return (
    <Link
      href={`${APP_ROUTES.invoices}/${revision.invoiceId}`}
      className="text-accent underline-offset-4 hover:underline"
    >
      {invoiceNumber(revision.number)}
    </Link>
  );
}
