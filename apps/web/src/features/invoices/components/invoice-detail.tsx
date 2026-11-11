"use client";

import {
  Badge,
  BigAmount,
  buttonClasses,
  cx,
  EmptyState,
  formatTokenAmount,
  PAYMENT_STATUS,
  Skeleton,
  StatusPill,
  TONES,
  WalletStateLabel,
} from "@forwend/ui-web";
import {
  ArrowLeftRight,
  ChevronRight,
  FileDown,
  FilePlus2,
  FileText,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import { useGetProfileInvoiceQuery } from "@/features/invoices/api/invoices-api";
import { CheckStatusNote } from "@/features/invoices/components/check-status";
import { InvoiceActions } from "@/features/invoices/components/invoice-actions";
import { InvoiceAmount } from "@/features/invoices/components/invoice-amount";
import { InvoiceHistory } from "@/features/invoices/components/invoice-history";
import { InvoiceLines } from "@/features/invoices/components/invoice-lines";
import {
  InvoiceMoneyLine,
  type MoneyTerm,
} from "@/features/invoices/components/invoice-money-line";
import {
  InvoicePayLinkActions,
  InvoicePayLinkPhone,
} from "@/features/invoices/components/invoice-pay-link";
import { ConfirmingStatus } from "@/features/invoices/components/invoice-progress";
import { InvoiceSteps } from "@/features/invoices/components/invoice-steps";
import { InvoiceTimeline } from "@/features/invoices/components/invoice-timeline";
import { PaymentAmountsNotice } from "@/features/invoices/components/payment-amounts-notice";
import { PaymentReminders } from "@/features/invoices/components/payment-reminders";
import { ReopenInvoice } from "@/features/invoices/components/reopen-invoice";
import { RepeatsMonthly } from "@/features/invoices/components/repeats-monthly";
import { SendToClient } from "@/features/invoices/components/send-to-client";
import {
  INVOICE_EXCEPTIONS,
  INVOICE_PDFS,
  PHONE_ACTION_BAR,
} from "@/features/invoices/constants/invoices";
import { INVOICE_COPY as COPY, REQUESTS_COPY } from "@/features/invoices/constants/invoices-copy";
import { useCheckStatus } from "@/features/invoices/hooks/use-check-status";
import {
  depositAmount,
  formatAgreed,
  formatDueDate,
  formatDueDateShort,
  invoiceCopyHref,
  invoiceException,
  invoiceNumber,
  invoicePdfUrl,
  invoiceProgress,
  invoiceStatus,
  linesFigures,
  optionFees,
  recordSteps,
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
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { MarkIcon } from "@/shared/components/chains/token-mark";
import { BackLink } from "@/shared/components/detail-header";
import { LoadError } from "@/shared/components/load-error";
import { Party } from "@/shared/components/party";
import { RecordLink } from "@/shared/components/record-link";
import { LineSkeleton } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { CHAINS, CROSS_CHAIN_STATUSES, TOKEN_ICONS } from "@/shared/constants/chains";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { API_PAYMENT_STATUSES } from "@/shared/constants/payment-state";
import { blockchainName, chainName, crossChainOptionRecorded } from "@/shared/lib/chains";
import { shortDate } from "@/shared/lib/dates";
import { exactDigits } from "@/shared/lib/money";
import { walletStateOf } from "@/shared/lib/payment-state";

const NOT_FOUND = 404;
const DAY_MS = 86_400_000;
const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const CLOCK = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const COUNTRY = new Intl.DisplayNames(undefined, { type: "region" });
const PANEL = "fw-panel";
const PANEL_TITLE = "fw-panel-head text-base font-semibold text-ink";
const FADE_IN = "motion-safe:animate-[fw-fade-in_var(--fw-duration-base)_var(--fw-ease-out)]";
const ICON = "size-[var(--fw-icon-sm)]";
// One header for both widths. Phones: Back and More on the first row, then a large title. Desktop: the number, then
// Edit and More on one row.
const HEADER =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 lg:items-start lg:gap-y-5";
const HEADER_MORE = "col-start-2 row-start-1";
const HEADER_TITLE = "col-span-2 flex min-w-0 items-start gap-3 lg:col-span-1 lg:row-start-1";
const TITLE = "break-words text-2xl font-semibold tracking-tight text-ink";
const TILE =
  "grid size-11 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-muted max-lg:hidden [&_svg]:size-[var(--fw-icon-md)]";
const AMOUNT = "max-w-full flex-wrap text-4xl [overflow-wrap:anywhere] sm:text-5xl";
// The amount card: the figure and what it means on the left, its breakdown beside it from large screens, as a
// receipt sets the total apart from its lines.
const AMOUNT_BODY =
  "grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,19rem)] lg:items-end";
const PHONE_ROW =
  "flex min-h-12 items-center justify-between gap-3 border-t border-line px-4 text-sm font-medium sm:px-6 lg:hidden";
// Phones read the panels in the owner's order; from large screens the money and records on the left, and the next
// step, the client and the details in a side column.
const GRID =
  "@container flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]";
const MAIN_COLUMN = "contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6";
const SIDE_COLUMN = "contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6";
const ORDER = {
  client: "order-1 lg:order-none",
  items: "order-2 lg:order-none",
  details: "order-3 lg:order-none",
  history: "order-4 lg:order-none",
} as const;

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
  const back = (
    <BackLink href={APP_ROUTES.invoices} label={request ? REQUESTS_COPY.invoices : COPY.back} />
  );

  if (invoice.data) {
    return (
      <Loaded
        back={back}
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
    );
  }
  if (failure?.status === NOT_FOUND || invoice.isError) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        {failure?.status === NOT_FOUND ? (
          <>
            <p className="text-muted">{COPY.notFound}</p>
            {notFound}
          </>
        ) : (
          <LoadError message={COPY.failed} onRetry={() => void invoice.refetch()} />
        )}
      </div>
    );
  }
  return <InvoiceSkeleton back={back} request={request} />;
}

function Loaded({
  back,
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
  back: ReactNode;
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
  // The option the money follows: the one the payer locked, or the only one.
  const shown = invoice.options.find((o) => o.optionId === invoice.optionId);
  const client = mine?.client;
  const issuer = invoice.issuer;
  const number = invoiceNumber(invoice.number);
  const noun = request ? COPY.noun.request : COPY.noun.invoice;
  // By the local clock; the status follows the API's closed flag, at most one poll later.
  const closed = Date.parse(invoice.closesAt) <= Date.now();
  const status = invoiceStatus(invoice);
  const { blocksLeft, blocksTotal, secondsLeft } = invoiceProgress(invoice);
  const wait = invoice.settlementWait ?? null;
  const exception = invoiceException(invoice, status);
  const received = exception.received;
  // R-77: a closed or canceled invoice's next step sits in the header; its status and Details say what
  // happened. Not while its records are in review or the final ones are still being read: money may still change
  // the answer. A revised one already has its replacement, linked in Details.
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
  const payLink = payable ? invoice.payToken : null;
  const recheck = useCheckStatus({
    payToken: payLink,
    network: chainName(invoice.chainId),
    money,
    nextCheckAt: invoice.nextCheckAt,
  });

  // The amount that matters now, large: what is due, what is left, or what reached the wallet.
  const paidAt = invoice.paidAt;
  const settled = invoice.settledAt !== null;
  const ended = status === PAYMENT_STATUS.expired || status === PAYMENT_STATUS.expiredPartiallyPaid;
  // A canceled invoice owes nothing: money after the cancel is held for the payer.
  const owing = !paidAt && !canceled && token !== undefined && received > 0n && received < amount;
  const fees = shown ? optionFees(shown) : null;
  // While the client picks, every option carries the same fees in USD (R-227), so the sum reads in USD.
  const lineMoney =
    choosing && shown
      ? (units: bigint) =>
          `${formatTokenAmount({ baseUnits: units, decimals: shown.decimals, fractionDigits: exactDigits(units, shown.decimals) })} ${MONEY_COPY.usd}`
      : money;
  const label =
    paidAt && settled
      ? COPY.inWallet
      : paidAt
        ? COPY.amount
        : ended
          ? COPY.notPaid
          : owing
            ? COPY.stillDue
            : waiting
              ? COPY.amountDue
              : COPY.amount;
  const figure = paidAt && settled && fees ? fees.net : owing ? amount - received : amount;
  const due = invoice.dueDate ? formatDueDateShort(invoice.dueDate, new Date()) : null;
  // One sentence: a bold part, then at most one short quiet part.
  const sentence: readonly [string, string | null] | null = canceled
    ? [COPY.say.canceled, null]
    : paidAt
      ? [COPY.say.paid(shortDate(paidAt)), null]
      : ended
        ? [COPY.say.closed(shortDate(invoice.closesAt)), null]
        : status === PAYMENT_STATUS.overdue && invoice.dueDate
          ? [
              COPY.say.late(
                Math.floor((Date.now() - Date.parse(`${invoice.dueDate}T00:00:00Z`)) / DAY_MS),
              ),
              COPY.say.until(shortDate(invoice.closesAt)),
            ]
          : owing
            ? due
              ? [COPY.say.due(due), COPY.say.rest]
              : [COPY.say.rest, null]
            : status === PAYMENT_STATUS.detected || status === PAYMENT_STATUS.confirming
              ? [COPY.say.arriving, null]
              : due
                ? [COPY.say.due(due), null]
                : null;
  // The money as one sum (R-228): what the client pays less each fee before a payment; once paid, what came in, the
  // extra refunded or held for the customer and each fee, down to the wallet. A fee of 0 is no term; a sum of one term
  // is none.
  const deposited = depositAmount(invoice, false);
  const extra = paidAt && deposited > amount ? deposited - amount : 0n;
  const returned = BigInt(shown?.amounts?.observedRefunded ?? "0");
  // biome-ignore lint/complexity/useMathMinMax: bigint amounts; Math.min throws on them
  const refunded = returned < extra ? returned : extra;
  const returnTx = shown?.amounts?.lastReturnTxHash;
  const paidUnits = amount + extra;
  const feeTerms: MoneyTerm[] = fees
    ? [
        ...(fees.network > 0n ? [{ label: COPY.networkFee, units: fees.network }] : []),
        ...(fees.platform > 0n ? [{ label: COPY.platformFee, units: fees.platform }] : []),
      ]
    : [];
  const terms: MoneyTerm[] =
    !fees || canceled || ended || owing
      ? []
      : paidAt
        ? [
            { label: COPY.terms.customerPaid, units: paidUnits },
            ...(refunded > 0n
              ? [
                  {
                    label: COPY.terms.refunded,
                    units: refunded,
                    after:
                      shown && returnTx ? (
                        <ExplorerLink chainId={shown.chainId} txHash={returnTx} className="-my-1" />
                      ) : null,
                  },
                ]
              : []),
            ...(extra > refunded ? [{ label: COPY.terms.held, units: extra - refunded }] : []),
            ...feeTerms,
            { label: settled ? COPY.inWallet : COPY.terms.toWallet, units: fees.net },
          ]
        : [
            { label: COPY.terms.clientPays, units: BigInt(shown?.amount ?? invoice.amount) },
            ...feeTerms,
            { label: COPY.youReceive, units: fees.net },
          ];
  const paymentHref = `${APP_ROUTES.payments}/${invoice.invoiceId}`;
  const receipt = invoice.paymentStatus === API_PAYMENT_STATUSES.paid ? invoice.payToken : null;
  const steps = recordSteps(invoice, sends, views);
  const lastSend = sends.at(-1);
  const sendNote = lastSend?.sentAt
    ? COPY.emailed(shortDate(lastSend.sentAt))
    : lastSend?.failedAt
      ? COPY.emailFailed
      : lastSend
        ? COPY.send.sending(client?.email ?? null)
        : null;
  const send =
    request || !payLink || !mine
      ? null
      : { profileId, invoiceId: invoice.invoiceId, number, email: client?.email ?? null, sends };
  const viewPayment = (
    <Link
      href={paymentHref}
      className={cx(buttonClasses({ variant: "ghost", size: "sm" }), "-ml-3 self-start")}
    >
      {COPY.viewPayment}
      <ChevronRight aria-hidden className={ICON} />
    </Link>
  );

  // The page's next step sits in the header from large screens; phones keep it in the bar at the bottom.
  const headerActions = payLink ? (
    <InvoicePayLinkActions payToken={payLink} />
  ) : paidAt ? (
    <>
      <Link href={paymentHref} className={buttonClasses({ variant: "secondary" })}>
        <ArrowLeftRight aria-hidden className={ICON} />
        {COPY.viewPayment}
      </Link>
      {receipt ? (
        <a
          href={invoicePdfUrl(receipt, INVOICE_PDFS.receipt)}
          className={buttonClasses({ variant: "secondary" })}
        >
          <FileDown aria-hidden className={ICON} />
          {COPY.pdf.receipt}
        </a>
      ) : null}
    </>
  ) : null;
  const paidBar = paidAt ? (
    <div className={`${PHONE_ACTION_BAR} lg:hidden`}>
      <Link
        href={paymentHref}
        className={cx(buttonClasses({ variant: "secondary" }), "h-11 flex-1")}
      >
        {COPY.viewPayment}
      </Link>
      {receipt ? (
        <a
          href={invoicePdfUrl(receipt, INVOICE_PDFS.receipt)}
          className={cx(buttonClasses({ variant: "secondary" }), "h-11 flex-1")}
        >
          <FileDown aria-hidden className={ICON} />
          {COPY.pdf.receipt}
        </a>
      ) : null}
    </div>
  ) : null;
  // R-77, R-130: each way on. Reopening is the first way to collect the rest while it can; the dialog says how.
  const restartActions = restart ? (
    <div className={cx(PHONE_ACTION_BAR, "lg:flex lg:items-center lg:gap-2")}>
      {reopen ? (
        <ReopenInvoice
          profileId={profileId}
          invoiceId={invoice.invoiceId}
          number={number}
          noun={noun}
          until={reopen}
          onReopened={() => setReopening(true)}
          className="max-lg:h-11 max-lg:flex-1"
        />
      ) : null}
      <Link
        href={invoiceCopyHref(invoice.invoiceId, false)}
        className={cx(
          buttonClasses({ variant: reopen ? "secondary" : "primary" }),
          "max-lg:h-11 max-lg:flex-1",
        )}
      >
        <FilePlus2 aria-hidden className={ICON} />
        {request ? COPY.newRequest : COPY.newInvoice}
      </Link>
    </div>
  ) : null;
  const phoneBar = Boolean(payLink || paidAt || restart);

  return (
    <div className={cx("flex flex-col gap-4 lg:gap-6", FADE_IN, phoneBar && "max-lg:pb-20")}>
      {/* R-60, R-69: the number and the state, then the amount that matters with the next step. */}
      <header className={HEADER}>
        {back}
        <div className={`${HEADER_MORE} flex items-center gap-2`}>
          {headerActions ? (
            <div className="flex items-center gap-2 max-lg:hidden">{headerActions}</div>
          ) : null}
          {restartActions}
          {paidBar}
          <InvoiceActions
            profileId={profileId}
            invoiceId={invoice.invoiceId}
            number={number}
            noun={noun}
            recheck={payLink ? recheck : null}
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
        </div>
        <div className={HEADER_TITLE}>
          <span className={TILE}>
            <FileText aria-hidden />
          </span>
          <div className="min-w-0">
            {/* Phones: the client is the large title, under the number and the title. */}
            <PhoneLabel parts={client?.name ? [number, invoice.title] : [invoice.title]} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className={TITLE}>
                {client?.name ? (
                  <>
                    <span className="max-lg:hidden">{number}</span>
                    <span className="lg:hidden">{client.name}</span>
                  </>
                ) : (
                  number
                )}
              </h1>
              <span className="flex flex-wrap items-center gap-2">
                {/* R-143: testnet money must never pass for real money. */}
                {invoice.livemode ? null : <Badge tone={TONES.warning}>{COPY.testnet}</Badge>}
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
                  <WalletStateLabel state={walletStateOf(invoice)} />
                ) : null}
              </span>
            </div>
            {invoice.title || (!request && client?.name) ? (
              <p className="mt-1 text-sm text-muted max-lg:hidden">
                {[invoice.title, request || !client?.name ? null : COPY.billedTo(client.name)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
        </div>
      </header>
      <PaymentAmountsNotice
        options={invoice.options}
        detailsHref={paymentHref}
        returnsShownFor={refunded > 0n && refunded === returned ? shown?.optionId : undefined}
      />

      <div className={GRID}>
        <div className={MAIN_COLUMN}>
          <section aria-labelledby="invoice-amount" className={`${PANEL} overflow-hidden`}>
            {/* A new state fades in where the old one was; polling that changes nothing keeps it still. */}
            <div key={status} className={cx(AMOUNT_BODY, FADE_IN)}>
              <div className="flex min-w-0 flex-col items-start">
                <p id="invoice-amount" className="text-sm font-medium text-muted">
                  {label}
                </p>
                <p className={cx("mt-1 max-w-full", canceled && "opacity-50")}>
                  {token ? (
                    <BigAmount
                      value={formatTokenAmount({
                        baseUnits: figure,
                        decimals: token.decimals,
                        fractionDigits: exactDigits(figure, token.decimals),
                      })}
                      unit={choosing ? MONEY_COPY.usd : token.symbol}
                      className={AMOUNT}
                    />
                  ) : (
                    <InvoiceAmount invoice={invoice} tokens={tokens} className="text-2xl" />
                  )}
                </p>
                <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                  {choosing ? (
                    COPY.clientChooses
                  ) : token ? (
                    <>
                      <MarkIcon
                        token={TOKEN_ICONS[token.symbol]}
                        chain={CHAINS[token.chainId]?.icon}
                        letter={token.symbol.slice(0, 1)}
                        small
                      />
                      {COPY.onNetwork(token.symbol, chainName(token.chainId))}
                    </>
                  ) : null}
                </p>
                {sentence ? (
                  <p className="mt-4 max-w-prose text-sm sm:text-base">
                    <b className="font-semibold text-ink">{sentence[0]}</b>
                    {sentence[1] ? <span className="text-muted"> {sentence[1]}</span> : null}
                  </p>
                ) : null}
                {/* R-54: why paid money still waits. */}
                {wait ? (
                  <p role="status" className="mt-2 text-sm text-muted">
                    {COPY.settling[wait.kind](
                      chainName(invoice.chainId),
                      wait.secondsLeft ?? 0,
                      wait.until ? CLOCK.format(new Date(wait.until)) : "",
                    )}
                  </p>
                ) : null}
                {/* R-55: what Check status, in More actions, found. */}
                {payLink ? <CheckStatusNote status={recheck} className="mt-2" /> : null}
                {paidAt ? null : <div className="mt-3 max-lg:hidden">{viewPayment}</div>}
              </div>
              {owing ? (
                <div className="flex w-full flex-col gap-2">
                  <Received share={Number((received * 1000n) / amount) / 10} />
                  <p className="text-sm text-muted">
                    {COPY.receivedOf(money(received), money(amount))}
                  </p>
                </div>
              ) : terms.length > 2 ? (
                <InvoiceMoneyLine terms={terms} money={lineMoney} className="w-full" />
              ) : null}
            </div>
            <InvoiceSteps steps={steps} className="border-t border-line px-6 py-5 max-lg:hidden" />
            {/* Phones: View payment is a row of this panel; once paid it waits in the bar. */}
            {paidAt ? null : (
              <Link
                href={paymentHref}
                className={`${PHONE_ROW} text-ink outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus`}
              >
                {COPY.viewPayment}
                <ChevronRight aria-hidden className={`${ICON} text-muted`} />
              </Link>
            )}
          </section>
          {payLink ? <InvoicePayLinkPhone payToken={payLink} /> : null}
          <InvoiceTimeline steps={steps} className="lg:hidden" />
          {/* The money line holds the totals: Items is only for an invoice with lines. */}
          {main && invoice.lines.length > 0 ? (
            <div className={ORDER.items}>
              <InvoiceLines
                lines={invoice.lines}
                decimals={main.decimals}
                unit={invoice.optionCount > 1 ? MONEY_COPY.usd : main.symbol}
                {...linesFigures(main, shown)}
              />
            </div>
          ) : null}
          <div className={ORDER.history}>
            <InvoiceHistory invoice={invoice} history={history} views={views} />
          </div>
        </div>

        <div className={SIDE_COLUMN}>
          {request ? null : (
            <section aria-labelledby="invoice-client" className={`${PANEL} ${ORDER.client}`}>
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
              {/* R-94: emailing the invoice is about the client, so it sits with them. */}
              {send ? (
                <div className="flex flex-col items-start gap-2 border-t border-line px-4 py-3 sm:px-5">
                  <SendToClient {...send} />
                  {sendNote ? <p className="text-xs text-muted">{sendNote}</p> : null}
                </div>
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
          <section aria-labelledby="invoice-details" className={`${PANEL} ${ORDER.details}`}>
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
              {/* R-239: what the client sent on its own chain, which NEAR Intents converted. */}
              {invoice.crossChain?.status === CROSS_CHAIN_STATUSES.success &&
              crossChainOptionRecorded(invoice) ? (
                <Row term={COPY.paidThrough}>
                  {COPY.paidThroughValue(
                    `${formatTokenAmount({
                      baseUnits: BigInt(
                        invoice.crossChain.deposited ?? invoice.crossChain.amountIn,
                      ),
                      decimals: invoice.crossChain.decimals,
                      fractionDigits: exactDigits(
                        BigInt(invoice.crossChain.deposited ?? invoice.crossChain.amountIn),
                        invoice.crossChain.decimals,
                      ),
                    })} ${invoice.crossChain.symbol}`,
                    blockchainName(invoice.crossChain.blockchain),
                  )}
                </Row>
              ) : null}
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
              <Row term={COPY.issuer} stacked>
                {issuer ? (
                  [
                    issuer.name,
                    issuer.email,
                    issuer.address,
                    COUNTRY.of(issuer.country) ?? issuer.country,
                    issuer.taxId ? `${COPY.taxId} ${issuer.taxId}` : null,
                  ]
                    .filter(Boolean)
                    .join("\n")
                ) : invoice.senderName ? (
                  invoice.senderName
                ) : (
                  <>
                    {COPY.noIssuer}{" "}
                    <Link
                      href={APP_ROUTES.billingDetails}
                      className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                    >
                      {COPY.addBillingDetails}
                    </Link>
                  </>
                )}
              </Row>
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
                  {receipt ? <PdfLink payToken={receipt} pdf={INVOICE_PDFS.receipt} /> : null}
                </span>
              </Row>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

/** The small line over a phone's large title. */
function PhoneLabel({ parts }: { parts: (string | null)[] }) {
  const text = parts.filter(Boolean).join(" · ");
  return text ? <p className="text-sm text-muted lg:hidden">{text}</p> : null;
}

/** How much of the amount arrived: a bar that fills once, beside the line that says it in figures. */
function Received({ share }: { share: number }) {
  return (
    <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-pill bg-line">
      <span
        className="block h-full origin-left rounded-pill bg-accent motion-safe:animate-[fw-grow_var(--fw-duration-slower)_var(--fw-ease-out)]"
        style={{ width: `${share}%` }}
      />
    </span>
  );
}

function Row({
  term,
  stacked = false,
  className,
  children,
  ref,
}: {
  term: string;
  stacked?: boolean;
  className?: string;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) {
  return stacked ? (
    <div className={cx("px-4 py-3 sm:px-5", className)}>
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="mt-1 text-sm break-words whitespace-pre-line text-ink">{children}</dd>
    </div>
  ) : (
    <div
      ref={ref}
      tabIndex={ref ? -1 : undefined}
      className={cx(
        "flex items-baseline justify-between gap-4 px-4 py-3 outline-none sm:px-5",
        className,
      )}
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
      <FileDown aria-hidden className={ICON} />
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

/** The page's shape while it loads: the same header, amount panel and panels, so nothing moves when the data comes.
 * Words that are the same on every invoice (panel titles, View payment) show at once; only the data is a
 * placeholder. */
function InvoiceSkeleton({ back, request }: { back: ReactNode; request: boolean }) {
  const title = (text: string) => <p className={PANEL_TITLE}>{text}</p>;
  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have nothing else to tell them apart
      <div key={i} className="flex items-baseline justify-between gap-4 px-4 py-3 sm:px-5">
        <LineSkeleton size="text-sm" className="w-20" />
        <LineSkeleton size="text-sm" className="w-28" />
      </div>
    ));
  const markers = (count: number) =>
    Array.from({ length: count }, (_, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: placeholder steps have nothing else to tell them apart
      <span key={i} className="flex min-w-0 flex-col gap-2">
        <span className="size-5 shrink-0 rounded-pill border border-line-strong" />
        <LineSkeleton size="text-sm" className="w-24 max-w-full" />
      </span>
    ));
  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <div className={HEADER}>
        {back}
        <div aria-hidden className={`${HEADER_MORE} flex gap-2`}>
          <Skeleton className="h-10 w-28 max-lg:hidden" />
          <Skeleton className="h-10 w-20 max-lg:hidden" />
          <Skeleton className="size-10" />
        </div>
        <div aria-hidden className={HEADER_TITLE}>
          <span className={TILE}>
            <FileText />
          </span>
          <div className="min-w-0 flex-1">
            <LineSkeleton size="text-sm lg:hidden" className="w-36" />
            <LineSkeleton size={TITLE} className="w-48 max-w-full" />
            <LineSkeleton size="mt-1 text-sm max-lg:hidden" className="w-56 max-w-full" />
          </div>
        </div>
      </div>
      <div aria-hidden className={GRID}>
        <div className={MAIN_COLUMN}>
          <div className={`${PANEL} overflow-hidden`}>
            <div className={AMOUNT_BODY}>
              <div className="flex min-w-0 flex-col items-start">
                <LineSkeleton size="text-sm" className="w-24" />
                <LineSkeleton size="mt-1 text-4xl sm:text-5xl" className="w-56 max-w-full" />
                <span className="mt-2 flex items-center gap-2">
                  <Skeleton className="size-6 rounded-pill" />
                  <LineSkeleton size="text-sm" className="w-28" />
                </span>
                <LineSkeleton size="mt-4 text-sm sm:text-base" className="w-60 max-w-full" />
              </div>
              <Skeleton className="h-32 w-full" />
            </div>
            <div className="grid auto-cols-fr grid-flow-col gap-4 border-t border-line px-6 py-5 max-lg:hidden">
              {markers(4)}
            </div>
            <p className={`${PHONE_ROW} text-ink`}>
              {COPY.viewPayment}
              <ChevronRight className={`${ICON} text-muted`} />
            </p>
          </div>
          <div className={`${PANEL} lg:hidden`}>
            {title(COPY.progressTitle)}
            <div className="flex flex-col gap-5 px-4 py-4 sm:px-5">{markers(4)}</div>
          </div>
          <div className={`${PANEL} ${ORDER.items}`}>
            {title(COPY.items)}
            {rows(2)}
          </div>
          <div className={`${PANEL} ${ORDER.history}`}>
            {title(COPY.history.title)}
            {rows(2)}
          </div>
        </div>
        <div className={SIDE_COLUMN}>
          {request ? null : (
            <div className={`${PANEL} ${ORDER.client}`}>
              {title(COPY.client)}
              <div className="px-4 py-3 sm:px-5">
                <LineSkeleton size="text-sm" className="w-32" />
                <LineSkeleton size="text-sm" className="w-44" />
                <LineSkeleton size="text-sm" className="w-36" />
              </div>
            </div>
          )}
          <div className={`${PANEL} ${ORDER.details}`}>
            {title(COPY.details)}
            {rows(4)}
          </div>
        </div>
      </div>
    </div>
  );
}
