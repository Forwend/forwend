"use client";

import {
  Badge,
  buttonClasses,
  EmptyState,
  formatTokenAmount,
  PAYMENT_STATUS,
  Skeleton,
  StatusPill,
  TONES,
  WalletStateLabel,
} from "@forwend/ui-web";
import { FileDown, FilePlus2, FileText, UserRound } from "lucide-react";
import Link from "next/link";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import { useGetProfileInvoiceQuery } from "@/features/invoices/api/invoices-api";
import { CheckStatus } from "@/features/invoices/components/check-status";
import { InvoiceActions } from "@/features/invoices/components/invoice-actions";
import { InvoiceAmount } from "@/features/invoices/components/invoice-amount";
import { InvoiceHistory } from "@/features/invoices/components/invoice-history";
import { InvoiceLines } from "@/features/invoices/components/invoice-lines";
import { ConfirmingStatus } from "@/features/invoices/components/invoice-progress";
import { InvoiceTimeline } from "@/features/invoices/components/invoice-timeline";
import { PaymentAmountsNotice } from "@/features/invoices/components/payment-amounts-notice";
import { PaymentReminders } from "@/features/invoices/components/payment-reminders";
import { ReopenInvoice } from "@/features/invoices/components/reopen-invoice";
import { RepeatsMonthly } from "@/features/invoices/components/repeats-monthly";
import { SendToClient } from "@/features/invoices/components/send-to-client";
import { INVOICE_EXCEPTIONS, INVOICE_PDFS } from "@/features/invoices/constants/invoices";
import { INVOICE_COPY as COPY, REQUESTS_COPY } from "@/features/invoices/constants/invoices-copy";
import {
  depositAmount,
  formatAgreed,
  formatDueDate,
  invoiceCopyHref,
  invoiceException,
  invoiceNumber,
  invoicePdfUrl,
  invoiceProgress,
  invoiceStatus,
  linesFigures,
  tokenKey,
} from "@/features/invoices/lib/invoices";
import type {
  Invoice,
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
import { BackLink, DetailHeader, DetailHeaderSkeleton } from "@/shared/components/detail-header";
import { LoadError } from "@/shared/components/load-error";
import { Party } from "@/shared/components/party";
import { RecordLink } from "@/shared/components/record-link";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { API_PAYMENT_STATUSES } from "@/shared/constants/payment-state";
import { chainName } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";
import { walletStateOf } from "@/shared/lib/payment-state";

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
  /** Under the not found line: the screen's way to the other mode (R-221). */
  notFound?: ReactNode;
}

// A 404 means another profile made the invoice (the public read needs the pay token, D-86), or it is of the profile's
// other mode (R-221).
// A personal profile's invoice is a request: it has no client and no due date.
export function InvoiceDetail({
  invoiceId,
  profileId,
  tokens,
  request = false,
  notFound,
}: InvoiceDetailProps) {
  const invoice = useGetProfileInvoiceQuery({ profileId, invoiceId, summary: true }, LIVE_QUERY);
  const mine = invoice.currentData ?? null;
  const failure = invoice.error as { status?: unknown } | undefined;

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <BackLink href={APP_ROUTES.invoices} label={request ? REQUESTS_COPY.invoices : COPY.back} />
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
          clientFailed={invoice.error !== undefined}
          tokens={tokens}
          request={request}
          onRetry={() => void invoice.refetch()}
          retrying={invoice.isFetching}
        />
      ) : failure?.status === NOT_FOUND ? (
        <>
          <p className="text-muted">{COPY.notFound}</p>
          {notFound}
        </>
      ) : invoice.isError ? (
        <LoadError message={COPY.failed} onRetry={() => void invoice.refetch()} />
      ) : (
        <>
          <DetailHeaderSkeleton icon={<FileText aria-hidden />} figure={COPY.amount} />
          <Skeleton className="h-64" />
        </>
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
  onRetry,
  retrying,
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
  onRetry: () => void;
  retrying: boolean;
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
  const wait = invoice.settlementWait ?? null;
  const exception = invoiceException(invoice, status);
  const received = exception.received;
  // R-77: a closed or canceled invoice's next step sits with its actions; its status and Details say what happened.
  // Not while its records are in review or the final ones are still being read: money may still change the answer.
  // A revised one already has its replacement, linked in Details.
  const restart =
    invoice.replacedBy ||
    invoice.amounts?.unreconciled ||
    invoice.amounts?.hasPolicyException ||
    (invoice.closed && invoice.amounts && BigInt(invoice.amounts.payable) > 0n)
      ? null
      : exception.kind;
  const reopen =
    restart === INVOICE_EXCEPTIONS.closedPartial ? (invoice.reopenUntil ?? null) : null;
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
  // Overdue is only open past its due date: its checkout still takes money and nothing has arrived.
  const waiting = status === PAYMENT_STATUS.open || status === PAYMENT_STATUS.overdue;
  // The pay link takes money only while these last; sharing it later only creates money held for a refund.
  const payable =
    !closed &&
    (waiting ||
      (
        [
          PAYMENT_STATUS.partiallyPaid,
          PAYMENT_STATUS.detected,
          PAYMENT_STATUS.confirming,
        ] as string[]
      ).includes(status));
  // Only before any money, on any option: cancel (R-79) and the edits the payer sees (R-128). The status says it:
  // money changes it, while dust under 1 USD on a payer-chooses invoice chooses nothing and leaves it open (R-119).
  const beforePayment = payable && waiting;
  return (
    <>
      {/* R-60: the number names the invoice; the line under it carries the title, client, due date and money. */}
      <DetailHeader
        icon={<FileText aria-hidden />}
        title={invoiceNumber(invoice.number)}
        // R-143: testnet money must never pass for real money.
        badges={
          <>
            {invoice.livemode ? null : <Badge tone={TONES.warning}>{COPY.testnet}</Badge>}
            {status === PAYMENT_STATUS.confirming ? (
              <span role="status" aria-label="Payment confirmation">
                <ConfirmingStatus blocks={blocksLeft} total={blocksTotal} seconds={secondsLeft} />
              </span>
            ) : (
              <StatusPill status={status} />
            )}
            {invoice.settlementStatus !== "none" ? (
              <WalletStateLabel state={walletStateOf(invoice)} />
            ) : null}
          </>
        }
        meta={
          [
            invoice.title,
            request ? null : client?.name ? COPY.billedTo(client.name) : null,
            invoice.dueDate ? COPY.dueOn(formatDueDate(invoice.dueDate)) : null,
            received > 0n && received < amount && token
              ? COPY.receivedOf(money(received), money(amount))
              : null,
            choosing ? COPY.clientChooses(invoice.optionCount) : null,
          ]
            .filter(Boolean)
            .join(" · ") || null
        }
        // R-54, R-55: why paid money still waits, and Check status while it can take money. Progress and every
        // transaction show on its payment page (View payment).
        summary={
          wait || (payable && invoice.payToken) ? (
            <>
              {wait ? (
                <p role="status" className="text-sm text-muted">
                  {COPY.settling[wait.kind](
                    chainName(invoice.chainId),
                    wait.secondsLeft ?? 0,
                    wait.until ? CLOCK.format(new Date(wait.until)) : "",
                  )}
                </p>
              ) : null}
              {payable && invoice.payToken ? (
                <CheckStatus
                  payToken={invoice.payToken}
                  network={chainName(invoice.chainId)}
                  money={money}
                  nextCheckAt={invoice.nextCheckAt}
                />
              ) : null}
            </>
          ) : undefined
        }
        figure={{
          label: received > 0n && received < amount ? COPY.total : COPY.amount,
          value: token ? (
            <>
              {formatTokenAmount({
                baseUnits: amount,
                decimals: token.decimals,
                fractionDigits: exactDigits(amount, token.decimals),
              })}{" "}
              <span className="text-base font-normal text-muted">
                {choosing ? MONEY_COPY.usd : token.symbol}
              </span>
            </>
          ) : (
            <InvoiceAmount invoice={invoice} tokens={tokens} />
          ),
        }}
        actions={
          <>
            {reopen ? (
              <ReopenInvoice
                profileId={profileId}
                invoiceId={invoice.invoiceId}
                number={invoiceNumber(invoice.number)}
                noun={request ? COPY.noun.request : COPY.noun.invoice}
                until={reopen}
                onReopened={() => setReopening(true)}
              />
            ) : null}
            {restart ? (
              // R-130: while it can reopen, reopening is the first way to collect the rest.
              <Link
                href={invoiceCopyHref(invoice.invoiceId, false)}
                className={buttonClasses({ variant: reopen ? "secondary" : "primary" })}
              >
                <FilePlus2 aria-hidden className="size-[var(--fw-icon-sm)]" />
                {request ? COPY.newRequest : COPY.newInvoice}
              </Link>
            ) : null}
            <Link
              href={`${APP_ROUTES.payments}/${invoice.invoiceId}`}
              className={buttonClasses({ variant: "secondary" })}
            >
              {COPY.viewPayment}
            </Link>
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
          </>
        }
      />
      <PaymentAmountsNotice
        options={invoice.options}
        detailsHref={`${APP_ROUTES.payments}/${invoice.invoiceId}`}
      />

      {/* minmax(0, 1fr): a long value never widens the column past the screen. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <div className="@container flex min-w-0 flex-col gap-4">
          {main ? (
            <InvoiceLines
              lines={invoice.lines}
              decimals={main.decimals}
              unit={invoice.optionCount > 1 ? MONEY_COPY.usd : main.symbol}
              {...linesFigures(
                main,
                invoice.options.find((o) => o.optionId === invoice.optionId),
              )}
              owner
              // One token only: with several, each option's money is in its own units. Money sent after the close
              // is the payer's, so it is not counted.
              received={invoice.optionCount === 1 ? depositAmount(invoice, false) : undefined}
            />
          ) : null}
          <div className="grid gap-4 @xl:grid-cols-2 *:only:col-span-full">
            {request ? null : (
              <section aria-labelledby="invoice-client" className={PANEL}>
                <h2 id="invoice-client" className={PANEL_TITLE}>
                  {COPY.client}
                </h2>
                {clientFailed ? (
                  <LoadError message={COPY.clientFailed} onRetry={onRetry} retrying={retrying} />
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
                  <EmptyState compact icon={UserRound} title={COPY.noClient} />
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
                  <Link
                    href={APP_ROUTES.billingDetails}
                    className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                  >
                    {COPY.addBillingDetails}
                  </Link>
                </p>
              )}
            </section>
          </div>
          <InvoiceHistory invoice={invoice} history={history} views={views} />
        </div>

        <div className="flex flex-col gap-4 xl:sticky xl:top-20">
          <section aria-labelledby="invoice-details" className={PANEL}>
            <h2 id="invoice-details" className={PANEL_TITLE}>
              {COPY.details}
            </h2>
            <dl className="divide-y divide-line">
              {invoice.store ? (
                <Row term={COPY.store}>
                  <RecordLink href={`${APP_ROUTES.stores}/${invoice.store.storeId}`}>
                    {invoice.store.name}
                  </RecordLink>
                </Row>
              ) : null}
              {invoice.linkId ? (
                <Row term={COPY.paymentLink}>
                  <RecordLink href={`${APP_ROUTES.links}/${invoice.linkId}`}>
                    {COPY.openLink}
                  </RecordLink>
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
          <InvoiceTimeline invoice={invoice} sends={sends} views={views} />
        </div>
      </div>
    </>
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
      className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
    >
      {invoiceNumber(revision.number)}
    </Link>
  );
}
