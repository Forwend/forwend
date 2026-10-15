"use client";

import {
  Button,
  buttonClasses,
  COPY_STATUS,
  formatTokenAmount,
  Money,
  QrCode,
  ReceiveAddress,
  Skeleton,
  shortAddress,
  useCopy,
} from "@forwend/ui-web";
import {
  CalendarDays,
  Check,
  Clock,
  Copy,
  ExternalLink,
  FileDown,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { notFound, usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useGetInvoiceQuery } from "@/features/invoices/api/invoices-api";
import { CheckStatus } from "@/features/invoices/components/check-status";
import { ConfirmingStatus, InvoiceTimeline } from "@/features/invoices/components/invoice-progress";
import { INVOICE_PDFS, INVOICE_STEPS } from "@/features/invoices/constants/invoices";
import {
  formatDueDate,
  invoiceNumber,
  invoicePdfUrl,
  invoiceProgress,
  isReturnLink,
} from "@/features/invoices/lib/invoices";
import type { Invoice } from "@/features/invoices/types/invoices";
import { type Choice, OptionPicker } from "@/features/pay/components/option-picker";
import { ReceiptEmail } from "@/features/pay/components/receipt-email";
import { PAY_STATES } from "@/features/pay/constants/pay";
import { PAY_COPY as COPY } from "@/features/pay/constants/pay-copy";
import {
  checkoutClosesAt,
  payState,
  payToken,
  receiptDeposits,
  shortDuration,
  withOption,
} from "@/features/pay/lib/pay";
import { checkedReceiveAddress } from "@/features/pay/lib/receive-address";
import type { PayToken } from "@/features/pay/types/pay";
import { ExplorerLink } from "@/shared/components/chains/explorer-link";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { addressLink, chainName, lookalikeOf, txLink } from "@/shared/lib/chains";
import { exactDigits } from "@/shared/lib/money";

const NOT_FOUND = 404;
const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const PANEL = "rounded-lg border border-line bg-surface";
const ICON = "size-[var(--fw-icon-md)] shrink-0";
const LINK =
  "inline-flex items-center gap-1 rounded-sm text-accent outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus";
const CLOSING_SOON_MS = 30 * 60_000;
// The payer's steps end at Paid: settling is the sender's business (R-68).
const PAYER_STEPS = [INVOICE_STEPS.detected, INVOICE_STEPS.confirming, INVOICE_STEPS.paid];

const formatMoney = (units: bigint, token: PayToken) =>
  `${formatTokenAmount({ baseUnits: units, decimals: token.decimals, fractionDigits: exactDigits(units, token.decimals) })} ${token.symbol}`;

export interface PayInvoiceProps {
  invoiceId: string;
  option?: string;
}

// The public read, again every REFRESH_MS while the tab is visible: the payer sees the status move without a reload.
export function PayInvoice({ invoiceId, option }: PayInvoiceProps) {
  const invoice = useGetInvoiceQuery(invoiceId, LIVE_QUERY);
  const failure = invoice.error as { status?: unknown } | undefined;
  if (invoice.data) {
    return (
      <>
        {/* A failed poll keeps the last read: say so, or a payer may think nothing arrived and send again. */}
        {invoice.isError ? (
          <p
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-md bg-warning-soft px-4 py-3 text-sm text-warning lg:col-span-2"
          >
            {COPY.stale}
            <Button size="sm" variant="secondary" onClick={invoice.refetch}>
              {COPY.retry}
            </Button>
          </p>
        ) : null}
        <Loaded invoice={invoice.data} linkInvoiceId={invoiceId} option={option} />
      </>
    );
  }
  if (failure?.status === NOT_FOUND) notFound();
  if (invoice.isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
        {COPY.failed}
        <Button size="sm" variant="secondary" onClick={invoice.refetch}>
          {COPY.retry}
        </Button>
      </div>
    );
  }
  return (
    <div aria-busy="true" className="flex flex-col gap-4 lg:col-span-2">
      <span role="status" className="sr-only">
        {COPY.loading}
      </span>
      <Skeleton className="h-24" />
      <Skeleton className="h-56" />
    </div>
  );
}

// The option whose address the payer asked to see, kept for the tab's life so a reload does not ask again (R-68).
const shownKey = (invoiceId: string) => `forwend:pay:${invoiceId}`;

function Loaded({
  invoice: answer,
  linkInvoiceId,
  option,
}: {
  invoice: Invoice;
  linkInvoiceId: string;
  option?: string;
}) {
  const now = useNow();
  const router = useRouter();
  const path = usePathname();
  // Payer chooses (R-57): until an option has money, the payer picks the network, then the token; the link keeps the
  // pick (?option=), so a reload shows the same.
  const choosing = !answer.optionLocked && answer.options.length > 1;
  const [picked, setPicked] = useState(option?.toLowerCase());
  const invoice = useMemo(() => withOption(answer, picked), [answer, picked]);
  const address = useMemo(
    () => checkedReceiveAddress(invoice, linkInvoiceId),
    [invoice, linkInvoiceId],
  );
  const token = payToken(invoice);
  const pickedOption = choosing ? answer.options.find((o) => o.optionId === picked) : undefined;
  const choice: Choice | null = choosing
    ? {
        options: answer.options,
        picked: pickedOption?.optionId,
        onPick: (id) => {
          setPicked(id);
          router.replace(id ? `${path}?option=${id}` : path, { scroll: false });
        },
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
      <Summary invoice={invoice} token={token} pay={pay} now={now} picking={picking} />
      <PayBox
        invoice={invoice}
        address={address}
        token={token}
        pay={pay}
        now={now}
        choice={choice}
        picking={picking}
      />
    </>
  );
}

type Pay = ReturnType<typeof payState>;

// Who asks and how much, in the reading order of an invoice: payee, number, amount, then its terms.
function Summary({
  invoice,
  token,
  pay,
  now,
  picking,
}: {
  invoice: Invoice;
  token: PayToken;
  pay: Pay;
  now: number;
  picking: boolean;
}) {
  const payee = invoice.issuer?.name ?? invoice.senderName;
  const number = invoiceNumber(invoice.number);
  const amount = BigInt(invoice.amount);
  const done = pay.state === PAY_STATES.paid || pay.state === PAY_STATES.settled;
  const partial = pay.canSend && pay.received > 0n;
  const shown = partial ? pay.remaining : amount;
  const closesAt = checkoutClosesAt(invoice);
  return (
    <section aria-labelledby="pay-amount" className="flex min-w-0 flex-col gap-6 lg:gap-8">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-md border border-line bg-surface text-lg font-semibold text-ink"
        >
          {(payee ?? COPY.noIssuer).trim().charAt(0).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-xl font-semibold break-words text-ink">{payee ?? COPY.noIssuer}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span className="break-words">
              {[invoice.issuer ? COPY.invoice(number) : COPY.request(number), invoice.title]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <a
              href={invoicePdfUrl(invoice.invoiceId, INVOICE_PDFS.invoice)}
              aria-label={COPY.pdfLabel}
              className={LINK}
            >
              <FileDown aria-hidden className="size-[var(--fw-icon-sm)]" />
              {COPY.pdf}
            </a>
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 id="pay-amount" className="text-sm text-muted">
          {done
            ? COPY.amountPaid
            : partial
              ? COPY.leftToPay
              : pay.state === PAY_STATES.canceled
                ? COPY.amount
                : COPY.amountDue}
        </h2>
        <Money
          baseUnits={shown}
          decimals={token.decimals}
          fractionDigits={exactDigits(shown, token.decimals)}
          token={picking ? MONEY_COPY.usd : token.symbol}
          className="min-w-0 text-amount-lg text-ink"
        />
        {picking ? null : (
          <p className="text-sm text-muted">{COPY.on(chainName(invoice.chainId))}</p>
        )}
      </div>
      {invoice.dueDate || pay.canSend ? (
        <ul className="flex flex-col divide-y divide-line border-y border-line text-sm text-muted">
          {invoice.dueDate ? (
            <li className="flex items-center gap-2.5 py-3">
              <CalendarDays aria-hidden className={ICON} />
              {COPY.due(formatDueDate(invoice.dueDate))}
            </li>
          ) : null}
          {/* Once paid or closed the countdown no longer matters to the payer. */}
          {pay.canSend ? (
            <li className="flex items-center gap-2.5 py-3">
              <Clock aria-hidden className={ICON} />
              <time dateTime={new Date(closesAt).toISOString()} title={TIME.format(closesAt)}>
                {COPY.closesIn(shortDuration(closesAt - now))}
              </time>
            </li>
          ) : null}
        </ul>
      ) : null}
      {invoice.note ? (
        <p className="max-w-prose border-l-2 border-line-strong pl-4 text-base break-words whitespace-pre-line text-ink">
          {invoice.note}
        </p>
      ) : null}
    </section>
  );
}

// The payer's side: how to pay while money is due; once money is seen, the steps it goes through and each payment (R-68).
function PayBox({
  invoice,
  address,
  token,
  pay,
  now,
  choice,
  picking,
}: {
  invoice: Invoice;
  address: string;
  token: PayToken;
  pay: Pay;
  now: number;
  choice: Choice | null;
  picking: boolean;
}) {
  const network = chainName(invoice.chainId);
  const lookalike = lookalikeOf(invoice.chainId, token.symbol);
  const contract = addressLink(invoice.chainId, invoice.token);
  const optionId = invoice.optionId;
  // The address shows once the payer asked for it for this option; a reload in the same tab keeps it.
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    try {
      setShown(sessionStorage.getItem(shownKey(invoice.invoiceId)));
    } catch {
      // Storage may be off: the payer asks again.
    }
  }, [invoice.invoiceId]);
  // The pressed button goes away: focus moves to the address it revealed.
  const sendHeading = useRef<HTMLHeadingElement>(null);
  const beforeHeading = useRef<HTMLHeadingElement>(null);
  const [presses, setPresses] = useState(0);
  useEffect(() => {
    if (presses > 0) sendHeading.current?.focus();
  }, [presses]);
  const show = () => {
    setShown(optionId);
    setPresses((n) => n + 1);
    try {
      sessionStorage.setItem(shownKey(invoice.invoiceId), optionId);
    } catch {
      // Storage may be off: the choice lasts until the page closes.
    }
  };
  // Back to the selects, with no address shown; focus stays in the box.
  const startOver = () => {
    setShown(null);
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
  const sending = shown === optionId && !picking;
  // Money seen and not yet paid: the box keeps its place and follows it, instead of a bare line.
  const seen =
    pay.state === PAY_STATES.confirming ||
    pay.state === PAY_STATES.checking ||
    pay.state === PAY_STATES.partial;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className={PANEL}>
        {done ? (
          <Paid invoice={invoice} token={token} />
        ) : (
          <>
            {pay.canSend || seen ? (
              <section aria-labelledby="pay-before" className="flex flex-col gap-4 p-4 sm:p-5">
                <h2
                  id="pay-before"
                  ref={beforeHeading}
                  tabIndex={-1}
                  className="text-sm font-medium text-ink outline-none"
                >
                  {pay.canSend ? COPY.payWith : COPY.payingWith}
                </h2>
                {choice && sending ? (
                  <PickedOption
                    chainId={invoice.chainId}
                    symbol={token.symbol}
                    onStartOver={startOver}
                  />
                ) : choice ? (
                  <OptionPicker {...choice} />
                ) : (
                  <TokenMark chainId={invoice.chainId} symbol={token.symbol} />
                )}
                {!pay.canSend || sending || picking ? null : (
                  <Button className="w-full" onClick={show}>
                    {COPY.showAddress}
                  </Button>
                )}
              </section>
            ) : null}
            {pay.canSend && sending ? (
              <section
                aria-labelledby="pay-send"
                className="flex flex-col gap-4 border-t border-line p-4 sm:p-5"
              >
                <h2 id="pay-send" ref={sendHeading} tabIndex={-1} className="sr-only">
                  {COPY.sendTo(token.symbol, network)}
                </h2>
                {/* What to send and where beside the code a phone scans; the address itself runs full width. */}
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
                  <QrCode
                    value={address}
                    label={COPY.qr}
                    className="w-28 border border-line p-1 sm:w-32"
                  />
                  <div className="flex min-w-0 flex-col gap-3">
                    <ExactAmount amount={pay.remaining} token={token} />
                    <p
                      role="note"
                      className="flex items-start gap-2 text-sm font-medium text-warning"
                    >
                      <TriangleAlert
                        aria-hidden
                        className="mt-0.5 size-[var(--fw-icon-sm)] shrink-0"
                      />
                      <span>
                        {COPY.sendOnly(token.symbol, network)}
                        {lookalike ? ` ${COPY.notLookalike(token.symbol, lookalike)}` : null}
                      </span>
                    </p>
                  </div>
                </div>
                <ReceiveAddress
                  address={address}
                  label={COPY.sendTo(token.symbol, network)}
                  copyShort={COPY.copyShort}
                  copiedShort={COPY.copiedShort}
                />
                {contract ? (
                  <p className="text-xs text-muted">
                    {COPY.contract(token.symbol)}{" "}
                    <a
                      href={contract.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-accent underline decoration-1 underline-offset-4 hover:decoration-2"
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
              <Received invoice={invoice} pay={pay} token={token} money={money} network={network} />
            ) : pay.state === PAY_STATES.waiting && !sending ? null : (
              // Waiting means something only once there is an address to pay.
              <StatusLine
                invoice={invoice}
                pay={pay}
                money={money}
                network={network}
                bordered={pay.canSend}
              />
            )}
          </>
        )}
        {/* The receipt by email, before or after paying, as the panel's last row; not for a canceled or closed
            checkout (R-82). */}
        {pay.canSend || seen || done ? (
          <ReceiptEmail invoiceId={invoice.invoiceId} paid={done} />
        ) : null}
      </div>
      {/* Overpaid gets its own handling later (PLAN 11.10.1); late money is held for the payer now. */}
      {pay.late > 0n ? (
        <p className="text-sm text-warning">{COPY.late(money(pay.late), payeeOf(invoice))}</p>
      ) : null}
      {pay.state === PAY_STATES.canceled && pay.received > 0n ? (
        <p className="text-sm text-warning">
          {COPY.canceledHeld(money(pay.received), payeeOf(invoice))}
        </p>
      ) : null}
      {invoice.options
        .filter((o) => o.optionId !== invoice.optionId && o.deposits.length > 0)
        .map((o) => {
          const units = o.deposits.reduce((sum, d) => sum + BigInt(d.amount), 0n);
          const amount = `${formatTokenAmount({ baseUnits: units, decimals: o.decimals, fractionDigits: exactDigits(units, o.decimals) })} ${o.symbol}`;
          return (
            <p key={o.optionId} className="text-sm text-warning">
              {COPY.otherOption(amount, chainName(o.chainId), payeeOf(invoice))}
            </p>
          );
        })}
    </div>
  );
}

// Before money is seen, or once the checkout closed: one line that updates by itself; waiting moves so it never reads
// as stuck.
function StatusLine({
  invoice,
  pay,
  money,
  network,
  bordered,
}: {
  invoice: Invoice;
  pay: Pay;
  money: (units: bigint) => string;
  network: string;
  bordered: boolean;
}) {
  const pending = pay.state === PAY_STATES.waiting;
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4 sm:p-5 ${bordered ? "border-t border-line" : ""}`}
    >
      <p role="status" className="flex items-start gap-2.5 text-sm font-medium text-ink">
        {pending ? (
          <span aria-hidden className="relative mt-1.5 flex size-2 shrink-0">
            <span className="absolute inset-0 rounded-pill bg-accent opacity-60 motion-safe:animate-ping" />
            <span className="relative size-2 rounded-pill bg-accent" />
          </span>
        ) : null}
        <span>{COPY.states[pay.state](values(invoice, pay, money))}</span>
      </p>
      {/* Money not seen yet may be a missed log: the payer can ask once in a while (R-55). */}
      {pending ? (
        <CheckStatus
          invoiceId={invoice.invoiceId}
          network={network}
          money={money}
          nextCheckAt={invoice.nextCheckAt}
        />
      ) : null}
    </div>
  );
}

const payeeOf = (invoice: Invoice) => invoice.issuer?.name ?? invoice.senderName ?? COPY.creator;

const values = (invoice: Invoice, pay: Pay, money: (units: bigint) => string) => ({
  received: money(pay.received),
  remaining: money(pay.remaining),
  total: money(BigInt(invoice.amount)),
  payee: payeeOf(invoice),
});

// A picked network and token, folded once the address shows. Changing takes two presses, so a payer who already sent
// money does not switch by accident and pay again on another network (R-68). Leaving the button cancels.
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
    <div className="flex items-center justify-between gap-3">
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

// Money seen: the steps to Paid, where they stand, and each payment with its transaction on the explorer.
function Received({
  invoice,
  pay,
  token,
  money,
  network,
}: {
  invoice: Invoice;
  pay: Pay;
  token: PayToken;
  money: (units: bigint) => string;
  network: string;
}) {
  const { blocksLeft, blocksTotal, secondsLeft } = invoiceProgress(invoice);
  return (
    <section
      aria-labelledby="pay-progress"
      className="flex flex-col gap-4 border-t border-line p-4 transition-[opacity,transform] duration-[var(--fw-duration-base)] ease-out starting:translate-y-1 starting:opacity-0 sm:p-5"
    >
      <h2 id="pay-progress" className="sr-only">
        {COPY.progress}
      </h2>
      <InvoiceTimeline invoice={invoice} label={COPY.progress} steps={PAYER_STEPS} />
      <p role="status" className="text-sm text-ink">
        {pay.state === PAY_STATES.confirming ? (
          <ConfirmingStatus blocks={blocksLeft} total={blocksTotal} seconds={secondsLeft} />
        ) : (
          COPY.states[pay.state](values(invoice, pay, money))
        )}
      </p>
      {pay.state === PAY_STATES.partial ? (
        <p className="text-sm text-muted">{COPY.copyFromHere}</p>
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
      {/* The rest may already be sent and missed: the payer can ask once in a while (R-55). */}
      {pay.state === PAY_STATES.partial ? (
        <CheckStatus
          invoiceId={invoice.invoiceId}
          network={network}
          money={money}
          nextCheckAt={invoice.nextCheckAt}
        />
      ) : null}
    </section>
  );
}

// Done for the payer: paid is the end. Whether the money already reached the sender is the sender's business (R-68).
function Paid({ invoice, token }: { invoice: Invoice; token: PayToken }) {
  const amount = BigInt(invoice.amount);
  const last = receiptDeposits(invoice).at(-1);
  const tx = last ? txLink(invoice.chainId, last.txHash) : null;
  const name = invoice.issuer?.name ?? invoice.senderName;
  const back = invoice.returnUrl && isReturnLink(invoice.returnUrl) ? invoice.returnUrl : null;
  const backLabel = back ? COPY.backTo(new URL(back).host) : "";
  return (
    <div className="flex flex-col items-center gap-5 px-5 py-8 text-center sm:px-6 sm:py-10">
      <span className="grid size-12 place-items-center rounded-pill bg-success-soft text-success transition-[opacity,transform] duration-[var(--fw-duration-base)] ease-out starting:scale-90 starting:opacity-0">
        <Check aria-hidden className="size-6" />
      </span>
      <div className="flex min-w-0 max-w-full flex-col gap-1 break-words">
        <p role="status" className="text-xl font-semibold text-ink">
          {COPY.paid}
        </p>
        <p className="text-sm text-muted">
          {COPY.paidTo(
            formatMoney(amount, token),
            name,
            invoice.paidAt ? TIME.format(Date.parse(invoice.paidAt)) : "",
          )}
        </p>
        <p className="text-sm text-muted">{COPY.closeHint}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {tx ? (
          <a
            href={tx.href}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            <ExternalLink aria-hidden className="size-[var(--fw-icon-sm)]" />
            {COPY.viewTx}
          </a>
        ) : null}
        <a
          href={invoicePdfUrl(invoice.invoiceId, INVOICE_PDFS.receipt)}
          className={buttonClasses({ variant: "secondary", size: "sm" })}
        >
          <FileDown aria-hidden className="size-[var(--fw-icon-sm)]" />
          {COPY.receiptPdf}
        </a>
      </div>
      {back ? (
        <a
          href={back}
          rel="noopener noreferrer"
          title={backLabel}
          className={`${buttonClasses({ variant: "primary" })} max-w-full`}
        >
          <span className="truncate">{backLabel}</span>
        </a>
      ) : null}
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
      <div className="flex items-center justify-between gap-2 rounded-md border border-line-strong bg-surface py-1.5 pr-1.5 pl-3">
        <Money
          baseUnits={amount}
          decimals={token.decimals}
          fractionDigits={fractionDigits}
          token={token.symbol}
          className="min-w-0 text-base font-semibold break-all text-ink"
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={copy}
          aria-label={label}
          className="shrink-0"
        >
          {status === COPY_STATUS.copied ? (
            <Check aria-hidden className="size-[var(--fw-icon-sm)]" />
          ) : (
            <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
          )}
          <span className="max-sm:sr-only">
            {status === COPY_STATUS.copied ? COPY.copiedShort : COPY.copyShort}
          </span>
        </Button>
      </div>
      <span role="status" className="sr-only">
        {status === COPY_STATUS.idle ? "" : label}
      </span>
    </div>
  );
}

/** The time now, once a second: the checkout countdown, and closing the checkout when it runs out. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
