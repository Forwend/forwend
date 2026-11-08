"use client";

import {
  BUTTON_VARIANTS,
  Button,
  buttonClasses,
  COPY_STATUS,
  DetailList,
  DetailRow,
  EmptyState,
  formatTokenAmount,
  IconButton,
  Money,
  QrCode,
  ReceiveAddress,
  Skeleton,
  shortAddress,
  useCopy,
} from "@forwend/ui-web";
import {
  Ban,
  CalendarDays,
  Check,
  Clock,
  Copy,
  ExternalLink,
  FileDown,
  Handshake,
  Hash,
  LoaderCircle,
  ShieldAlert,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  useCountViewMutation,
  useGetInvoiceQuery,
  usePickOptionMutation,
  useRecheckInvoiceMutation,
} from "@/features/invoices/api/invoices-api";
import { CheckStatus, recheckKey } from "@/features/invoices/components/check-status";
import { InvoiceLines } from "@/features/invoices/components/invoice-lines";
import { ConfirmingStatus, InvoiceTimeline } from "@/features/invoices/components/invoice-progress";
import { PaymentAmountsNotice } from "@/features/invoices/components/payment-amounts-notice";
import {
  DOCUMENT_KINDS,
  HISTORY_FIELDS,
  INVOICE_PDFS,
  INVOICE_STEPS,
} from "@/features/invoices/constants/invoices";
import { INVOICE_COPY } from "@/features/invoices/constants/invoices-copy";
import {
  depositAmount,
  formatAgreed,
  formatDueDate,
  invoiceNumber,
  invoicePdfUrl,
  invoiceProgress,
  isReturnLink,
  linesFigures,
  optionFees,
} from "@/features/invoices/lib/invoices";
import type { Invoice } from "@/features/invoices/types/invoices";
import { Backdrop } from "@/features/pay/components/backdrop";
import { NeedHelp } from "@/features/pay/components/need-help";
import { type Choice, OptionPicker } from "@/features/pay/components/option-picker";
import { Payee } from "@/features/pay/components/payee";
import { ReceiptEmail } from "@/features/pay/components/receipt-email";
import { TestnetBadge } from "@/features/pay/components/testnet-badge";
import { EMBED_LAYOUTS } from "@/features/pay/constants/embed";
import { ENTER, LEFT_PAD, PAY_STATES, RIGHT_PAD } from "@/features/pay/constants/pay";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import {
  checkoutClosesAt,
  clockRuns,
  firstPaymentOption,
  overpaid,
  payerNoticeOptions,
  payState,
  payToken,
  receiptDeposits,
  shortDuration,
  withOption,
} from "@/features/pay/lib/pay";
import { checkedReceiveAddress } from "@/features/pay/lib/receive-address";
import type { EmbedLayout, PayToken } from "@/features/pay/types/pay";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { ServerStrip } from "@/shared/components/server-strip";
import { LIVE_QUERY, REFRESH_MS } from "@/shared/config/refresh";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { addressLink, chainName, lookalikeOf, txLink } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

const NOT_FOUND = 404;
const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const CLOCK = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const PANEL = "fw-panel sm:rounded-lg";
const ICON = "size-[var(--fw-icon-md)] shrink-0";
const CLOSING_SOON_MS = 30 * 60_000;
// The payer's steps end at Paid: settling is the sender's business (R-68).
const PAYER_STEPS = [INVOICE_STEPS.detected, INVOICE_STEPS.confirming, INVOICE_STEPS.paid];

const formatMoney = (units: bigint, token: PayToken) =>
  `${formatTokenAmount({ baseUnits: units, decimals: token.decimals, fractionDigits: exactDigits(units, token.decimals) })} ${token.symbol}`;

export interface PayInvoiceProps {
  /** The pay link's token (D-86). */
  linkToken: string;
  option?: string;
  /** The owner's preview from their payment page: it counts no view. */
  preview?: boolean;
  /** In a merchant's page (R-168): links that would leave the frame open a tab or the top page instead. */
  embed?: EmbedLayout;
}

export function PayInvoice({ linkToken, option, preview = false, embed }: PayInvoiceProps) {
  // The checkout shares the link page's store, so Back then Forward finds an older read: read it again once it is
  // older than one refresh. Pay's own read, a moment old, opens the checkout without a second request.
  const invoice = useGetInvoiceQuery(linkToken, {
    ...LIVE_QUERY,
    refetchOnMountOrArgChange: REFRESH_MS / 1000,
  });
  const [countView] = useCountViewMutation();
  // R-125: one view per load. The ref holds across React's dev double mount, and status refreshes don't count.
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current || preview) return;
    counted.current = true;
    countView(linkToken);
  }, [countView, linkToken, preview]);
  const failure = invoice.error as { status?: unknown } | undefined;
  if (invoice.data) {
    // A failed poll keeps the last read: say so above everything, or a payer may think nothing arrived and send again.
    // From large screens it spans both halves, its text centered. data-stale: PayScreen gives it its own row.
    // error, not isError: a retry in flight keeps the error, so the strip stays put until a read succeeds.
    const stale = invoice.error ? (
      <div data-stale className="lg:col-span-2">
        <ServerStrip className="lg:rounded-none" />
      </div>
    ) : null;
    return (
      <Loaded
        invoice={invoice.data}
        linkToken={linkToken}
        option={option}
        preview={preview}
        stale={stale}
        readAt={invoice.fulfilledTimeStamp ?? null}
        embed={embed}
      />
    );
  }
  if (failure?.status === NOT_FOUND) notFound();
  if (invoice.isError) {
    // data-load-error: the page centers this state alone (PayScreen).
    return (
      <div
        role="alert"
        data-load-error
        className="mx-auto w-full max-w-lg lg:col-span-2 lg:self-center lg:justify-self-center"
      >
        <EmptyState
          icon={WifiOff}
          title={COPY.failedTitle}
          description={COPY.failed}
          action={
            <Button variant="secondary" onClick={invoice.refetch}>
              {COPY.retry}
            </Button>
          }
        />
      </div>
    );
  }
  // In the loaded page's own columns and backdrop (Loaded), so each placeholder sits where its part arrives.
  return (
    <>
      <Backdrop />
      <span role="status" className="sr-only">
        {COPY.loading}
      </span>
      <div aria-busy="true" className={`contents lg:flex lg:flex-col lg:gap-6 lg:pt-8 ${LEFT_PAD}`}>
        <div className="order-1 flex flex-col gap-5 lg:gap-6">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-md sm:size-11" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-48" />
          </div>
        </div>
      </div>
      <div
        aria-hidden
        className={`order-2 flex min-w-0 flex-col gap-4 lg:self-stretch lg:py-8 lg:pl-16 ${RIGHT_PAD}`}
      >
        <div className="lg:my-auto">
          <div className={`${PANEL} flex flex-col gap-4 p-4 sm:p-5`}>
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        </div>
      </div>
    </>
  );
}

// The option whose address the payer asked to see, kept for the tab's life so a reload does not ask again (R-68).
const shownKey = (invoiceId: string) => `forwend:pay:${invoiceId}`;

function Loaded({
  invoice: answer,
  linkToken,
  option,
  preview,
  stale,
  readAt,
  embed,
}: {
  invoice: Invoice;
  linkToken: string;
  option?: string;
  preview: boolean;
  stale: ReactNode;
  /** When the read was answered: the confirming estimate counts from it. */
  readAt: number | null;
  embed?: EmbedLayout;
}) {
  // Payer chooses (R-57): Show address keeps the pick on the invoice, so the pay link opens on it again. `?option=`
  // (the canary's) opens one option and keeps nothing; neither does the owner's preview.
  const choosing = !answer.optionLocked && answer.options.length > 1 && !firstPaymentOption(answer);
  // Loaded mounts only once the client has the read, so storage can be read while rendering.
  const [tabShown] = useState(() => {
    try {
      return sessionStorage.getItem(shownKey(answer.invoiceId));
    } catch {
      // Storage may be off: the payer asks again.
      return null;
    }
  });
  // The kept pick counts only where the payer chooses, never on `?option=`: the canary always presses Show address.
  // This tab's pick comes first: the owner's preview keeps none on the invoice, and a keep can fail.
  const kept = choosing && !option ? (tabShown ?? answer.pickedOptionId ?? null) : null;
  const [picked, setPicked] = useState(option?.toLowerCase() ?? kept ?? undefined);
  const [pickOption] = usePickOptionMutation();
  const keep =
    choosing && !preview && !option
      ? (optionId: string) => void pickOption({ payToken: linkToken, optionId })
      : undefined;
  const invoice = useMemo(() => withOption(answer, picked), [answer, picked]);
  // The shown option's clock: late money on a picked option is checked though the invoice itself has closed.
  const now = useNow(clockRuns(invoice));
  const address = useMemo(() => checkedReceiveAddress(invoice, linkToken), [invoice, linkToken]);
  const token = payToken(invoice);
  const pickedOption = choosing ? answer.options.find((o) => o.optionId === picked) : undefined;
  const choice: Choice | null = choosing
    ? {
        options: answer.options,
        picked: pickedOption?.optionId,
        onPick: setPicked,
      }
    : null;
  // Before a pick the amount is the same in every option: USD at 1 per stablecoin (D-75), with no network yet.
  const picking = choice !== null && !choice.picked;

  if (!address || !token) {
    return (
      <p
        role="alert"
        className="flex items-start gap-3 rounded-md bg-danger-soft px-4 py-3 text-danger lg:col-span-2"
      >
        <ShieldAlert aria-hidden className={ICON} />
        {address ? COPY.unknownToken : COPY.mismatch}
      </p>
    );
  }
  const pay = payState(invoice, now);
  return (
    <>
      <Backdrop color={invoice.brand?.color} />
      {stale}
      {/* From large screens the summary is the left column; on phones it dissolves (contents) and order keeps the pay
          panel right under the amount. */}
      <div className={`contents lg:flex lg:flex-col lg:gap-6 lg:pt-8 ${LEFT_PAD}`}>
        <Summary invoice={invoice} token={token} pay={pay} picking={picking} />
        {/* The merchant's own checkout page already shows the order. */}
        {embed === EMBED_LAYOUTS.element ? null : <Terms invoice={invoice} linkToken={linkToken} />}
      </div>
      {/* "Closes in" stays at the top right like a header; the pay panel stands in the middle of the screen's height. */}
      <div
        className={`order-2 flex min-w-0 flex-col gap-4 lg:self-stretch lg:py-8 lg:pl-16 ${RIGHT_PAD}`}
      >
        {pay.canSend ? <Closes invoice={invoice} now={now} /> : null}
        <div className="lg:my-auto">
          <PayBox
            invoice={invoice}
            linkToken={linkToken}
            address={address}
            token={token}
            pay={pay}
            now={now}
            readAt={readAt}
            choice={choice}
            picking={picking}
            tabShown={tabShown}
            kept={kept}
            keep={keep}
            embed={embed}
          />
        </div>
      </div>
    </>
  );
}

type Pay = ReturnType<typeof payState>;

// On phones the pay panel follows right under it, so a payer reaches the address without scrolling.
function Summary({
  invoice,
  token,
  pay,
  picking,
}: {
  invoice: Invoice;
  token: PayToken;
  pay: Pay;
  picking: boolean;
}) {
  const payee = invoice.issuer?.name ?? invoice.senderName;
  const brand = invoice.brand;
  const number = invoiceNumber(invoice.number);
  const amount = BigInt(invoice.amount);
  const done = pay.state === PAY_STATES.paid || pay.state === PAY_STATES.settled;
  const partial = pay.canSend && pay.received > 0n;
  const shown = partial ? pay.remaining : amount;
  const fees = optionFees(invoice);
  const units = (n: bigint) =>
    `${formatTokenAmount({ baseUnits: n, decimals: token.decimals, fractionDigits: exactDigits(n, token.decimals) })} ${token.symbol}`;
  return (
    <section aria-labelledby="pay-amount" className="order-1 flex min-w-0 flex-col gap-5 lg:gap-6">
      <div className="flex items-center justify-between gap-3">
        <Payee
          name={payee ?? COPY.noIssuer}
          subtitle={
            invoice.documentKind === DOCUMENT_KINDS.none
              ? COPY.checkout
              : invoice.issuer
                ? COPY.invoice(number)
                : COPY.request(number)
          }
          brand={brand}
        />
        {invoice.livemode ? null : <TestnetBadge />}
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 id="pay-amount" className="text-sm text-muted">
          {done
            ? COPY.amountPaid
            : partial
              ? COPY.leftToPay
              : pay.canSend
                ? COPY.amountDue
                : COPY.amount}
        </h2>
        <Money
          baseUnits={shown}
          decimals={token.decimals}
          fractionDigits={exactDigits(shown, token.decimals)}
          token={picking ? MONEY_COPY.usd : token.symbol}
          className="min-w-0 text-amount-lg text-ink"
        />
        {/* Kept in place while the payer picks, so the network's line arriving moves nothing below it. */}
        <p className={`text-sm text-muted ${picking ? "invisible" : ""}`}>
          {COPY.on(chainName(invoice.chainId))}
        </p>
        {picking &&
        invoice.options.some((o) => {
          const f = optionFees(o);
          return f.clientPays && f.total > 0n;
        }) ? (
          <p className="text-sm text-muted">{COPY.feeByNetwork}</p>
        ) : null}
        {fees.clientPays && fees.total > 0n && !picking && !partial ? (
          <p className="text-sm text-muted">
            {COPY.withFees(units(fees.net), [
              ...(fees.network > 0n ? [COPY.networkFee(units(fees.network))] : []),
              ...(fees.platform > 0n ? [COPY.platformFee(units(fees.platform))] : []),
            ])}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Terms({ invoice, linkToken }: { invoice: Invoice; linkToken: string }) {
  const main = invoice.options.find((o) => o.optionId === invoice.invoiceId);
  const lineToken = main
    ? payToken({ ...invoice, chainId: main.chainId, token: main.token })
    : null;
  const shownToken = payToken(invoice);
  return (
    <div className="order-3 flex min-w-0 flex-col items-start gap-4 lg:gap-5">
      {invoice.title ? (
        <p className="text-base font-medium break-words text-ink">{invoice.title}</p>
      ) : null}
      {invoice.lines.length > 0 && main && lineToken ? (
        <div className="w-full">
          <InvoiceLines
            lines={invoice.lines}
            decimals={lineToken.decimals}
            unit={
              invoice.documentKind === DOCUMENT_KINDS.none || invoice.optionCount > 1
                ? MONEY_COPY.usd
                : lineToken.symbol
            }
            // The shown option's terms, which the page checked against its address, when their units match.
            {...linesFigures(
              { ...main, decimals: lineToken.decimals },
              shownToken ? { ...invoice, decimals: shownToken.decimals } : undefined,
            )}
            plain
          />
        </div>
      ) : null}
      {invoice.reference || invoice.agreedValue || invoice.dueDate ? (
        <ul className="flex max-w-full flex-col gap-2.5 text-sm text-muted">
          {/* The client's accounts team matches the invoice by it (R-90). */}
          {invoice.reference ? (
            <li className="flex items-center gap-2.5">
              <Hash aria-hidden className={ICON} />
              <span className="min-w-0 break-words">{COPY.reference(invoice.reference)}</span>
            </li>
          ) : null}
          {/* The price agreed in fiat (R-93); the payer still pays the amount above. */}
          {invoice.agreedValue ? (
            <li className="flex items-center gap-2.5">
              <Handshake aria-hidden className={ICON} />
              {COPY.agreed(
                formatAgreed(invoice.agreedValue),
                formatDueDate(invoice.agreedValue.date),
              )}
            </li>
          ) : null}
          {invoice.dueDate ? (
            <li className="flex items-center gap-2.5">
              <CalendarDays aria-hidden className={ICON} />
              {COPY.due(formatDueDate(invoice.dueDate))}
            </li>
          ) : null}
        </ul>
      ) : null}
      {invoice.note ? (
        <p className="max-w-prose border-l-2 border-line-strong pl-4 text-sm break-words whitespace-pre-line text-ink sm:text-base">
          {invoice.note}
        </p>
      ) : null}
      {invoice.updates.length > 0 ? (
        <section aria-labelledby="pay-updates" className="flex flex-col gap-1.5 text-sm">
          <h2 id="pay-updates" className="text-xs font-medium text-muted">
            {COPY.updates.title}
          </h2>
          <ul className="flex flex-col gap-1 text-muted">
            {invoice.updates.map((u) => (
              <li key={`${u.at}-${u.field}-${u.from}-${u.to}`}>
                <time dateTime={u.at}>{TIME.format(new Date(u.at))}</time>
                {" · "}
                {u.field === HISTORY_FIELDS.dueDate
                  ? COPY.updates.dueDate(
                      u.from ? formatDueDate(u.from) : null,
                      u.to ? formatDueDate(u.to) : null,
                    )
                  : u.field === HISTORY_FIELDS.note
                    ? COPY.updates.note
                    : COPY.updates.reference}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {invoice.documentKind !== DOCUMENT_KINDS.none ? (
        <a
          href={invoicePdfUrl(linkToken, INVOICE_PDFS.invoice)}
          className="-mx-1 inline-flex items-center gap-2 rounded-sm px-1 text-sm font-medium text-ink underline decoration-line-strong underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          <FileDown aria-hidden className={ICON} />
          {COPY.pdfLabel}
        </a>
      ) : null}
    </div>
  );
}

// R-68.
function PayBox({
  invoice,
  linkToken,
  address,
  token,
  pay,
  now,
  readAt,
  choice,
  picking,
  tabShown,
  kept,
  keep,
  embed,
}: {
  invoice: Invoice;
  linkToken: string;
  address: string;
  token: PayToken;
  pay: Pay;
  now: number;
  readAt: number | null;
  choice: Choice | null;
  picking: boolean;
  /** The option whose address this tab showed before a reload (R-68). */
  tabShown: string | null;
  /** The option this tab showed, else the one kept on the invoice: its address shows again (R-57, R-68). */
  kept: string | null;
  /** Keeps the shown option on the invoice for the payer's next visit (R-57). */
  keep?: (optionId: string) => void;
  embed?: EmbedLayout;
}) {
  // A canceled invoice takes no money on any option; invoice.closed is only the checkout's time.
  const canChoose =
    choice !== null &&
    pay.state !== PAY_STATES.canceled &&
    !invoice.closed &&
    choice.options.some(
      (option) => now < checkoutClosesAt({ closesAt: option.closesAt ?? invoice.closesAt }),
    );
  const network = chainName(invoice.chainId);
  // Found money locks the pick: paying again on another option would be a second payment.
  const found = useFound(linkToken, pay);
  const lookalike = lookalikeOf(invoice.chainId, token.symbol);
  const contract = addressLink(invoice.chainId, invoice.token);
  const optionId = invoice.optionId;
  // The address shows once the payer asked for it for this option: in this tab, or kept on the invoice (R-57). After
  // Change it is "" until the next Show address, so the kept pick doesn't bring the old address back.
  const [shown, setShown] = useState(tabShown);
  // The pressed button goes away: focus moves to the address it revealed.
  const sendHeading = useRef<HTMLHeadingElement>(null);
  const beforeHeading = useRef<HTMLHeadingElement>(null);
  const [presses, setPresses] = useState(0);
  useEffect(() => {
    if (presses > 0) sendHeading.current?.focus();
  }, [presses]);
  // Found money takes away the Check status just pressed: focus waits on the address heading, not the page. The
  // heading is clipped off-screen, so focusing it must not scroll the found line away.
  useEffect(() => {
    if (found > 0n && document.activeElement === document.body)
      sendHeading.current?.focus({ preventScroll: true });
  }, [found]);
  const show = () => {
    setShown(optionId);
    setPresses((n) => n + 1);
    keep?.(optionId);
    try {
      sessionStorage.setItem(shownKey(invoice.invoiceId), optionId);
    } catch {
      // Storage may be off: the choice lasts until the page closes.
    }
  };
  // Back to the selects, with no address shown; focus stays in the box.
  const startOver = () => {
    setShown("");
    try {
      sessionStorage.removeItem(shownKey(invoice.invoiceId));
    } catch {
      // Storage may be off: nothing was kept.
    }
    choice?.onPick(undefined);
    beforeHeading.current?.focus();
  };
  const money = (units: bigint) => formatMoney(units, token);
  const done = pay.state === PAY_STATES.paid || pay.state === PAY_STATES.settled;
  const sending = (shown ?? kept) === optionId && !picking;
  const seen =
    pay.state === PAY_STATES.confirming ||
    pay.state === PAY_STATES.checking ||
    pay.state === PAY_STATES.partial;
  // Once the token and network are settled they fold into one row, so the address or the status leads.
  const folded = choice ? sending : sending || !pay.canSend;
  // Nothing more to send: what was seen leads the panel, and the option it went to follows.
  const statusFirst = seen && !pay.canSend;
  const received = seen ? (
    <Received
      invoice={invoice}
      linkToken={linkToken}
      pay={pay}
      token={token}
      money={money}
      network={network}
      readAt={readAt}
      lead={statusFirst}
    />
  ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className={PANEL}>
        {done ? (
          <Paid invoice={invoice} linkToken={linkToken} token={token} embed={embed} />
        ) : (
          <>
            {statusFirst ? received : null}
            {(pay.canSend || seen || canChoose) && folded ? (
              <section
                aria-labelledby="pay-before"
                className={`flex min-h-16 items-center gap-3 px-4 py-3 sm:px-5 ${ENTER} ${statusFirst ? "border-t border-line" : ""}`}
              >
                <h2
                  id="pay-before"
                  ref={beforeHeading}
                  tabIndex={-1}
                  className="w-20 shrink-0 text-sm text-muted outline-none"
                >
                  {pay.canSend || canChoose ? COPY.payWith : COPY.payingWith}
                </h2>
                {choice && found === 0n ? (
                  <PickedOption
                    chainId={invoice.chainId}
                    symbol={token.symbol}
                    onStartOver={startOver}
                  />
                ) : (
                  <TokenMark chainId={invoice.chainId} symbol={token.symbol} />
                )}
              </section>
            ) : pay.canSend || canChoose ? (
              <section
                aria-labelledby="pay-before"
                className={`flex flex-col gap-4 p-4 sm:p-5 ${ENTER}`}
              >
                <h2
                  id="pay-before"
                  ref={beforeHeading}
                  tabIndex={-1}
                  className="text-sm font-medium text-ink outline-none"
                >
                  {COPY.payWith}
                </h2>
                {choice ? (
                  <OptionPicker {...choice} />
                ) : (
                  <TokenMark chainId={invoice.chainId} symbol={token.symbol} />
                )}
                {!pay.canSend || picking ? null : (
                  // After a pick it appears on its own; without one it comes with the section, which already rises.
                  <div className={choice ? ENTER : undefined}>
                    <Button size="lg" className="w-full" onClick={show}>
                      {COPY.showAddress}
                    </Button>
                  </div>
                )}
              </section>
            ) : null}
            {pay.canSend && sending ? (
              <section
                aria-labelledby="pay-send"
                className={`flex flex-col gap-4 border-t border-line p-4 sm:p-5 ${ENTER}`}
              >
                <h2 id="pay-send" ref={sendHeading} tabIndex={-1} className="sr-only">
                  {COPY.sendTo(token.symbol, network)}
                </h2>
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 sm:gap-4">
                  <QrCode
                    value={address}
                    label={COPY.qr}
                    className="w-26 border border-line p-1 sm:w-32"
                  />
                  <div className="flex min-w-0 flex-col gap-2">
                    <ExactAmount amount={pay.remaining} token={token} />
                    <p
                      role="note"
                      className="flex flex-col gap-0.5 text-xs font-medium text-warning"
                    >
                      <span className="flex items-start gap-1.5">
                        <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
                        {COPY.sendOnly(token.symbol, network)}
                      </span>
                      {/* The space keeps the two sentences apart when read aloud; the flex column drops it on screen. */}
                      {lookalike ? " " : null}
                      {lookalike ? (
                        <span className="pl-5">{COPY.notLookalike(token.symbol, lookalike)}</span>
                      ) : null}
                    </p>
                  </div>
                </div>
                <ReceiveAddress address={address} label={COPY.sendTo(token.symbol, network)} />
                {contract ? (
                  <p className="text-xs text-muted">
                    {COPY.contract(token.symbol)}{" "}
                    <a
                      href={contract.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-ink underline decoration-line-strong decoration-1 underline-offset-4 hover:decoration-2"
                    >
                      {shortAddress(invoice.token)}
                      {/* Never the full contract address here: next to the one to pay, it could be copied instead. */}
                      <span className="sr-only">{` on ${contract.name}${COPY.newTab}`}</span>
                    </a>
                  </p>
                ) : null}
                <p className="text-xs text-muted">
                  {checkoutClosesAt(invoice) - now < CLOSING_SOON_MS
                    ? `${COPY.closingSoon} `
                    : null}
                  {COPY.exchange(money(pay.remaining), network)}
                </p>
              </section>
            ) : null}
            {seen ? (
              statusFirst ? null : (
                received
              )
            ) : pay.state === PAY_STATES.waiting && !sending ? null : (
              // Waiting means something only once there is an address to pay.
              <StatusLine
                invoice={invoice}
                linkToken={linkToken}
                pay={pay}
                money={money}
                network={network}
                bordered={pay.canSend}
                choosable={canChoose}
              />
            )}
          </>
        )}
        {/* From the first money seen, so a payer can leave before the final check (R-82). */}
        {seen || done ? <ReceiptEmail linkToken={linkToken} paid={done} /> : null}
      </div>
      <PaymentAmountsNotice
        options={payerNoticeOptions(invoice.options)}
        showVerification={pay.state !== PAY_STATES.review}
      />
      {pay.late > 0n ? <HeldNote>{COPY.late(money(pay.late))}</HeldNote> : null}
      {/* R-129: a Revise canceled it for a new invoice, whose own pay link takes the payment. */}
      {invoice.replacedBy?.payToken ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink">
          {COPY.replaced(invoiceNumber(invoice.replacedBy.number))}
          {/* No page but /embed opens in a frame: from an embed the new invoice opens in a tab. */}
          <Link
            href={`/pay/${invoice.replacedBy.payToken}`}
            target={embed ? "_blank" : undefined}
            rel={embed ? "noopener" : undefined}
            className={buttonClasses({ size: "sm", variant: "secondary" })}
          >
            {COPY.openReplacement(invoiceNumber(invoice.replacedBy.number))}
          </Link>
        </p>
      ) : null}
      {pay.state === PAY_STATES.canceled && pay.received > 0n ? (
        <HeldNote>{COPY.canceledHeld(money(pay.received))}</HeldNote>
      ) : null}
      {/* Held only once an option was chosen (R-119): until then money on another option may still be the one. */}
      {invoice.options
        .filter(
          (o) =>
            invoice.optionLocked &&
            o.optionId !== invoice.optionId &&
            (o.amounts ? BigInt(o.amounts.held) > 0n : o.deposits.length > 0),
        )
        .map((o) => {
          const units = o.amounts
            ? BigInt(o.amounts.held)
            : depositAmount(o, false) + depositAmount(o, true);
          const amount = `${formatTokenAmount({ baseUnits: units, decimals: o.decimals, fractionDigits: exactDigits(units, o.decimals) })} ${o.symbol}`;
          return (
            <HeldNote key={o.optionId}>{COPY.otherOption(amount, chainName(o.chainId))}</HeldNote>
          );
        })}
    </div>
  );
}

function StatusLine({
  invoice,
  linkToken,
  pay,
  money,
  network,
  bordered,
  choosable,
}: {
  invoice: Invoice;
  linkToken: string;
  pay: Pay;
  money: (units: bigint) => string;
  network: string;
  bordered: boolean;
  /** Another option can still be picked: a closed one then keeps its one-line row under the pickers. */
  choosable: boolean;
}) {
  const missing = useFound(linkToken, pay);
  // Never "Waiting for payment" beside what a check found.
  const found = missing > 0n;
  const pending = pay.state === PAY_STATES.waiting && !found;
  // Nothing to pay and nothing to pick: the panel says so in the middle, as an empty state does.
  const shut =
    !choosable && (pay.state === PAY_STATES.canceled || pay.state === PAY_STATES.closed)
      ? pay.state
      : null;
  return (
    // What a check found takes its own row, so the button never moves when it answers.
    <div
      className={`${shut ? "" : "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 p-4 sm:p-5"} ${bordered ? "border-t border-line" : ""}`}
    >
      {/* One live region in every state, so a payer watching hears the payment close. */}
      <div
        role="status"
        className={shut ? undefined : "flex items-start gap-2.5 text-sm font-medium text-ink"}
      >
        {shut ? (
          <EmptyState
            compact
            icon={shut === PAY_STATES.canceled ? Ban : Clock}
            title={COPY.closedTitles[shut]}
            description={COPY.states[shut](values(invoice, pay, money))}
          />
        ) : found ? (
          <LoaderCircle
            aria-hidden
            className={`${ICON} text-muted motion-safe:animate-[fw-spin_var(--fw-duration-slower)_linear_infinite]`}
          />
        ) : pending ? (
          <span aria-hidden className="relative mt-1.5 flex size-2 shrink-0">
            <span className="absolute inset-0 rounded-pill bg-accent opacity-60 motion-safe:animate-ping" />
            <span className="relative size-2 rounded-pill bg-accent" />
          </span>
        ) : pay.closed ? (
          <Clock aria-hidden className={`${ICON} text-muted`} />
        ) : null}
        {shut ? null : (
          <span>{found ? COPY.found : COPY.states[pay.state](values(invoice, pay, money))}</span>
        )}
      </div>
      {/* Always rendered, so the live region exists before a check finds money. */}
      <p
        role="status"
        className={found ? "col-start-1 row-start-2 -mt-1.5 pl-6.5 text-xs text-muted" : "sr-only"}
      >
        {found ? COPY.foundNote(money(missing)) : null}
      </p>
      {pay.state === PAY_STATES.closedPartial ? (
        <div className="col-start-2 row-start-1">
          <GetItBack />
        </div>
      ) : null}
      {/* Placed under the status, so the button keeps the first row and a check's answer the third. */}
      {pending ? (
        <p className="col-start-1 row-start-2 -mt-1.5 pl-4.5 text-xs text-muted">
          {COPY.updatesItself}
        </p>
      ) : null}
      {/* Money not seen yet may be a missed log: the payer can ask once in a while (R-55). Found money needs no
          other check. */}
      {pending ? (
        <CheckStatus
          payToken={linkToken}
          network={network}
          money={money}
          nextCheckAt={invoice.nextCheckAt}
          className="contents"
          messageClassName="col-span-2"
        />
      ) : null}
    </div>
  );
}

/** What a check found that the ledger has not booked yet (R-55), or 0. */
function useFound(linkToken: string, pay: Pay): bigint {
  const [, { data: recheck }] = useRecheckInvoiceMutation({ fixedCacheKey: recheckKey(linkToken) });
  const missing = BigInt(recheck?.onChain ?? "0") - BigInt(recheck?.recorded ?? "0");
  return pay.state === PAY_STATES.waiting && recheck?.rescanning && missing > 0n ? missing : 0n;
}

const payeeOf = (invoice: Invoice) => invoice.issuer?.name ?? invoice.senderName ?? COPY.creator;

const values = (invoice: Invoice, pay: Pay, money: (units: bigint) => string) => ({
  delayed: pay.delayed,
  received: money(pay.received),
  remaining: money(pay.remaining),
  total: money(BigInt(invoice.amount)),
  payee: payeeOf(invoice),
});

// Changing takes two presses, so a payer who already sent can't switch by accident and pay twice (R-68).
function PickedOption({
  chainId,
  symbol,
  onStartOver,
}: {
  chainId: number;
  symbol: string;
  onStartOver: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <TokenMark chainId={chainId} symbol={symbol} />
      {/* One button whose label changes keeps focus between the two presses. */}
      <Button
        size="sm"
        variant={asking ? "secondary" : "ghost"}
        aria-label={asking ? undefined : COPY.changeLabel}
        onBlur={() => setAsking(false)}
        onClick={() => (asking ? onStartOver() : setAsking(true))}
      >
        {asking ? COPY.confirmChange : COPY.change}
      </Button>
    </div>
  );
}

function Received({
  invoice,
  linkToken,
  pay,
  token,
  money,
  network,
  readAt,
  lead,
}: {
  invoice: Invoice;
  linkToken: string;
  pay: Pay;
  token: PayToken;
  money: (units: bigint) => string;
  network: string;
  readAt: number | null;
  /** Nothing more is due: the panel opens with what was seen and when it is final. */
  lead: boolean;
}) {
  const { blocksLeft, blocksTotal, secondsLeft } = invoiceProgress(invoice);
  const confirming = pay.state === PAY_STATES.confirming;
  // secondsLeft changes only when the network's final block moves, every few minutes; each poll reads it again. So
  // count from the read that first gave this value, or the time would creep later with every poll, then jump back.
  const seen = useRef({ seconds: -1, at: 0 });
  if (readAt !== null && seen.current.seconds !== secondsLeft)
    seen.current = { seconds: secondsLeft, at: readAt };
  const final =
    confirming && readAt !== null && secondsLeft > 0
      ? CLOCK.format(seen.current.at + secondsLeft * 1000)
      : null;
  return (
    <section
      aria-labelledby="pay-progress"
      className={`flex flex-col gap-4 p-4 sm:p-5 ${ENTER} ${lead ? "" : "border-t border-line"}`}
    >
      <h2 id="pay-progress" className="sr-only">
        {COPY.progress}
      </h2>
      {lead ? <p className="text-base font-semibold text-ink">{COPY.seen}</p> : null}
      <InvoiceTimeline invoice={invoice} label={COPY.progress} steps={PAYER_STEPS} />
      <div className="-mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p role="status" className="text-sm text-ink">
          {confirming ? (
            <ConfirmingStatus blocks={blocksLeft} total={blocksTotal} seconds={secondsLeft} />
          ) : (
            COPY.states[pay.state](values(invoice, pay, money))
          )}
        </p>
        {final ? (
          <p className="text-sm text-muted tabular-nums">{COPY.finalAround(final)}</p>
        ) : null}
      </div>
      {lead ? <p className="-mt-2 text-sm text-muted">{COPY.nothingToDo}</p> : null}
      {invoice.depositSummary && invoice.depositSummary.count > invoice.deposits.length ? (
        <p className="text-xs text-muted">{INVOICE_COPY.depositPreview}</p>
      ) : null}
      <ul className="divide-y divide-line rounded-md border border-line">
        {invoice.deposits
          .filter((d) => !d.late)
          .map((d) => {
            const amount = BigInt(d.amount);
            return (
              <li
                key={`${d.txHash}:${d.logIndex}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 text-sm"
              >
                <span className="flex flex-col">
                  <Money
                    baseUnits={amount}
                    decimals={token.decimals}
                    fractionDigits={exactDigits(amount, token.decimals)}
                    token={token.symbol}
                    className="text-ink"
                  />
                  <time dateTime={d.blockTime} className="text-xs text-muted">
                    {TIME.format(Date.parse(d.blockTime))}
                  </time>
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-mono text-xs text-muted" title={d.txHash}>
                    {shortAddress(d.txHash)}
                  </span>
                  <ExplorerLink chainId={invoice.chainId} txHash={d.txHash} named />
                </span>
              </li>
            );
          })}
      </ul>
      <Overpaid invoice={invoice} money={money} />
      {/* The rest may already be sent and missed: the payer can ask once in a while (R-55). */}
      {pay.state === PAY_STATES.partial ? (
        <CheckStatus
          payToken={linkToken}
          network={network}
          money={money}
          nextCheckAt={invoice.nextCheckAt}
        />
      ) : null}
    </section>
  );
}

/** Money over the amount stays held for the payer (D-24). */
function Overpaid({ invoice, money }: { invoice: Invoice; money: (units: bigint) => string }) {
  const extra = overpaid(invoice);
  if (extra <= 0n) return null;
  return <HeldNote>{COPY.overpaid(money(extra))}</HeldNote>;
}

/** Money held for the payer, with the way to get it back. A div: the dialog inside can't sit in a paragraph. */
function HeldNote({ children }: { children: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-warning">
      <p>{children}</p>
      <GetItBack />
    </div>
  );
}

/** Opens Need help, which says how held money comes back (PLAN 11.10). */
function GetItBack() {
  return (
    <NeedHelp
      trigger={(open) => (
        <Button variant={BUTTON_VARIANTS.link} className="text-sm" onClick={open}>
          {COPY.howToGetBack}
        </Button>
      )}
    />
  );
}

// Paid is the end for the payer: settling is the sender's business (R-68).
function Paid({
  invoice,
  linkToken,
  token,
  embed,
}: {
  invoice: Invoice;
  linkToken: string;
  token: PayToken;
  embed?: EmbedLayout;
}) {
  const amount = BigInt(invoice.amount);
  const last = receiptDeposits(invoice).at(-1);
  const tx = last ? txLink(invoice.chainId, last.txHash) : null;
  const name = invoice.issuer?.name ?? invoice.senderName;
  // An element sits in the merchant's own page, which goes on by itself: it has no way back to offer.
  const back =
    embed !== EMBED_LAYOUTS.element && invoice.returnUrl && isReturnLink(invoice.returnUrl)
      ? invoice.returnUrl
      : null;
  const backLabel = back ? COPY.backTo(new URL(back).host) : "";
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 p-4 sm:p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-pill bg-success-soft text-success transition-[opacity,scale] duration-[var(--fw-duration-base)] ease-out starting:scale-90 starting:opacity-0">
          <Check aria-hidden className="size-5" />
        </span>
        <div className="min-w-0">
          <p role="status" className="text-lg font-semibold text-ink">
            {COPY.paid}
          </p>
          {embed ? null : <p className="text-sm text-muted">{COPY.closeHint}</p>}
        </div>
      </div>
      <DetailList className="border-y border-line">
        <DetailRow term={COPY.receiptRows.amount}>
          <span className="font-medium tabular-nums">{formatMoney(amount, token)}</span>
        </DetailRow>
        {name ? <DetailRow term={COPY.receiptRows.to}>{name}</DetailRow> : null}
        {invoice.paidAt ? (
          <DetailRow term={COPY.receiptRows.date}>
            <time dateTime={invoice.paidAt}>{TIME.format(Date.parse(invoice.paidAt))}</time>
          </DetailRow>
        ) : null}
        {tx ? (
          <DetailRow term={COPY.receiptRows.transaction}>
            <a
              href={tx.href}
              target="_blank"
              rel="noopener noreferrer"
              title={last?.txHash}
              className={`${buttonClasses({ variant: "link" })} gap-1.5 text-sm`}
            >
              {COPY.viewTx}
              <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
            </a>
          </DetailRow>
        ) : null}
      </DetailList>
      <div className="px-4 pt-4 empty:hidden sm:px-5">
        <Overpaid invoice={invoice} money={(units) => formatMoney(units, token)} />
      </div>
      {/* With a return link the way back leads, and the receipt steps down to secondary under it. */}
      <div className="flex flex-col gap-2 p-4 sm:p-5">
        {back ? (
          // From a full embed the way back leaves the merchant's checkout page, not the frame.
          <a
            href={back}
            target={embed ? "_top" : undefined}
            rel="noopener noreferrer"
            title={backLabel}
            className={`${buttonClasses({ variant: "primary", size: "lg" })} w-full`}
          >
            <span className="truncate">{backLabel}</span>
          </a>
        ) : null}
        <a
          href={invoicePdfUrl(linkToken, INVOICE_PDFS.receipt)}
          className={`${buttonClasses({ variant: back ? "secondary" : "primary", size: "lg" })} w-full`}
        >
          <FileDown aria-hidden className="size-[var(--fw-icon-sm)]" />
          {COPY.receiptPdf}
        </a>
      </div>
    </div>
  );
}

// Wallets and exchanges reject "1,250.50": the copy is the plain decimal, exact to the base unit.
function ExactAmount({ amount, token }: { amount: bigint; token: PayToken }) {
  const fractionDigits = exactDigits(amount, token.decimals);
  const plain = formatTokenAmount({
    baseUnits: amount,
    decimals: token.decimals,
    fractionDigits,
  }).replaceAll(",", "");
  const [status, copy] = useCopy(plain);
  const label =
    status === COPY_STATUS.copied
      ? COPY.amountCopied
      : status === COPY_STATUS.failed
        ? COPY.copyAmountFailed
        : COPY.copyAmount;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs text-muted">{COPY.exactAmount}</span>
      <div className="flex items-center justify-between gap-2 rounded-md border border-field bg-surface py-1 pr-1 pl-3">
        <Money
          baseUnits={amount}
          decimals={token.decimals}
          fractionDigits={fractionDigits}
          token={token.symbol}
          className="min-w-0 text-base font-semibold break-all text-ink"
        />
        <IconButton label={label} title={label} onClick={copy}>
          {status === COPY_STATUS.copied ? (
            <Check aria-hidden className="size-[var(--fw-icon-sm)] text-success" />
          ) : (
            <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
          )}
        </IconButton>
      </div>
      <span role="status" className="sr-only">
        {status === COPY_STATUS.idle ? "" : label}
      </span>
    </div>
  );
}

function useNow(running: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

/** Over the pay panel while the checkout can take money; the last 30 minutes in the warning color. */
function Closes({ invoice, now }: { invoice: Invoice; now: number }) {
  const closesAt = checkoutClosesAt(invoice);
  return (
    <p
      className={`flex items-center gap-1.5 self-end text-sm max-lg:self-start ${closesAt - now < CLOSING_SOON_MS ? "text-warning" : "text-muted"}`}
    >
      <Clock aria-hidden className="size-[var(--fw-icon-sm)]" />
      <time dateTime={new Date(closesAt).toISOString()} title={TIME.format(closesAt)}>
        {COPY.closesIn(shortDuration(closesAt - now))}
      </time>
    </p>
  );
}
