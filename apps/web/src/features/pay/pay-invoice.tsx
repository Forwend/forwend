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
  useCopy,
} from "@forwend/ui-web";
import { Check, Copy, FileDown, ShieldAlert } from "lucide-react";
import { notFound, usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckStatus } from "@/features/invoices/components/check-status";
import { ConfirmingStatus } from "@/features/invoices/components/invoice-progress";
import {
  exactDigits,
  formatDueDate,
  INVOICE_PDFS,
  type Invoice,
  invoiceNumber,
  invoicePdfUrl,
  invoiceProgress,
  isReturnLink,
} from "@/features/invoices/invoices";
import { useGetInvoiceQuery } from "@/features/invoices/invoices-api";
import { type Choice, OptionPicker } from "@/features/pay/option-picker";
import {
  checkoutClosesAt,
  PAY_STATES,
  type PayToken,
  payState,
  payToken,
  receiptDeposits,
  shortDuration,
  withOption,
} from "@/features/pay/pay";
import { PAY_COPY as COPY } from "@/features/pay/pay-copy";
import { checkedReceiveAddress } from "@/features/pay/receive-address";
import { chainName, txLink } from "@/shared/chains/chains";
import { TokenMark } from "@/shared/chains/token-mark";
import { LIVE_QUERY } from "@/shared/config/refresh";

const NOT_FOUND = 404;
const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const PANEL = "rounded-lg border border-line bg-surface";
const ICON = "size-[var(--fw-icon-md)] shrink-0";
const LINK =
  "inline-flex items-center gap-1 rounded-sm text-accent outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus";
const CLOSING_SOON_MS = 30 * 60_000;

const formatMoney = (units: bigint, token: PayToken) =>
  `${formatTokenAmount({ baseUnits: units, decimals: token.decimals, fractionDigits: exactDigits(units, token.decimals) })} ${token.symbol}`;

// The public read, again every REFRESH_MS while the tab is visible: the payer sees the status move without a reload.
export function PayInvoice({ invoiceId, option }: { invoiceId: string; option?: string }) {
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
    <section aria-labelledby="pay-amount" className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold break-words text-ink">{payee ?? COPY.noIssuer}</h1>
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
      <div className="flex flex-col gap-1">
        <h2 id="pay-amount" className="text-sm text-muted">
          {done ? COPY.amountPaid : partial ? COPY.leftToPay : COPY.amountDue}
        </h2>
        <Money
          baseUnits={shown}
          decimals={token.decimals}
          fractionDigits={exactDigits(shown, token.decimals)}
          token={picking ? COPY.usd : token.symbol}
          className="min-w-0 text-amount-lg text-ink"
        />
        {picking ? null : (
          <p className="text-sm text-muted">{COPY.on(chainName(invoice.chainId))}</p>
        )}
      </div>
      {invoice.dueDate || pay.canSend ? (
        <ul className="flex flex-col gap-1 text-sm text-muted">
          {invoice.dueDate ? <li>{COPY.due(formatDueDate(invoice.dueDate))}</li> : null}
          {/* Once paid or closed the countdown no longer matters to the payer. */}
          {pay.canSend ? (
            <li>
              <time dateTime={new Date(closesAt).toISOString()} title={TIME.format(closesAt)}>
                {COPY.closesIn(shortDuration(closesAt - now))}
              </time>
            </li>
          ) : null}
        </ul>
      ) : null}
      {invoice.note ? (
        <p className="border-l-2 border-line pl-3 text-sm break-words whitespace-pre-line text-ink">
          {invoice.note}
        </p>
      ) : null}
    </section>
  );
}

// The payer's side: how to pay while money is due, then one line on where the payment stands (R-68).
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
  const money = (units: bigint) => formatMoney(units, token);
  const done = pay.state === PAY_STATES.paid || pay.state === PAY_STATES.settled;
  const sending = shown === optionId && !picking;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className={PANEL}>
        {done ? (
          <Paid invoice={invoice} token={token} />
        ) : pay.canSend ? (
          <>
            <section aria-labelledby="pay-before" className="flex flex-col gap-4 p-4 sm:p-5">
              <h2 id="pay-before" className="text-sm font-medium text-ink">
                {COPY.payWith}
              </h2>
              {choice ? (
                <OptionPicker {...choice} />
              ) : (
                <TokenMark chainId={invoice.chainId} symbol={token.symbol} />
              )}
              {sending || picking ? null : (
                <Button className="w-full" onClick={show}>
                  {COPY.showAddress}
                </Button>
              )}
            </section>
            {sending ? (
              <section
                aria-labelledby="pay-send"
                className="flex flex-col gap-4 border-t border-line p-4 sm:p-5"
              >
                <h2 id="pay-send" ref={sendHeading} tabIndex={-1} className="sr-only">
                  {COPY.sendTo(token.symbol, network)}
                </h2>
                <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
                  {/* A payer on this phone cannot scan its own screen: Copy comes first there. */}
                  <QrCode
                    value={address}
                    label={COPY.qr}
                    className="w-36 justify-self-center border border-line max-sm:order-last"
                  />
                  <div className="flex min-w-0 flex-col gap-3">
                    <ReceiveAddress address={address} label={COPY.sendTo(token.symbol, network)} />
                    <ExactAmount amount={pay.remaining} token={token} />
                  </div>
                </div>
                <p role="note" className="text-sm font-medium text-warning">
                  {COPY.sendOnly(token.symbol, network)}
                </p>
                <p className="text-xs text-muted">
                  {checkoutClosesAt(invoice) - now < CLOSING_SOON_MS
                    ? `${COPY.closingSoon} `
                    : null}
                  {COPY.exchange(money(pay.remaining))}
                </p>
              </section>
            ) : null}
          </>
        ) : null}
        {done ? null : (
          <StatusLine
            invoice={invoice}
            pay={pay}
            money={money}
            network={network}
            bordered={pay.canSend}
          />
        )}
      </div>
      {pay.extra > 0n ? (
        <p className="text-sm text-warning">{COPY.extra(money(pay.extra))}</p>
      ) : null}
      {pay.late > 0n ? <p className="text-sm text-warning">{COPY.late(money(pay.late))}</p> : null}
      {pay.canSend ? (
        <NeedHelp named={Boolean(invoice.issuer?.name ?? invoice.senderName)} />
      ) : null}
    </div>
  );
}

// Where the payment stands, in one line that updates by itself; a pending state moves so it never reads as stuck.
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
  const { blocksLeft, secondsLeft } = invoiceProgress(invoice);
  const pending =
    pay.state === PAY_STATES.waiting ||
    pay.state === PAY_STATES.partial ||
    pay.state === PAY_STATES.confirming ||
    pay.state === PAY_STATES.checking;
  const values = {
    received: money(pay.received),
    remaining: money(pay.remaining),
    total: money(BigInt(invoice.amount)),
  };
  return (
    <div className={`flex flex-col gap-3 p-4 sm:p-5 ${bordered ? "border-t border-line" : ""}`}>
      <p role="status" className="flex items-start gap-2.5 text-sm text-ink">
        {pending ? (
          <span aria-hidden className="relative mt-1.5 flex size-2 shrink-0">
            <span className="absolute inset-0 rounded-pill bg-accent opacity-60 motion-safe:animate-ping" />
            <span className="relative size-2 rounded-pill bg-accent" />
          </span>
        ) : null}
        <span>
          {COPY.states[pay.state](values)}
          {pay.state === PAY_STATES.confirming ? (
            <ConfirmingStatus blocks={blocksLeft} seconds={secondsLeft} />
          ) : null}
        </span>
      </p>
      {/* Money not seen yet may be a missed log: the payer can ask once in a while (R-55). */}
      {pay.state === PAY_STATES.waiting || pay.state === PAY_STATES.partial ? (
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

// Done for the payer: paid is the end. Whether the money already reached the sender is the sender's business (R-68).
function Paid({ invoice, token }: { invoice: Invoice; token: PayToken }) {
  const amount = BigInt(invoice.amount);
  const last = receiptDeposits(invoice).at(-1);
  const tx = last ? txLink(invoice.chainId, last.txHash) : null;
  const name = invoice.issuer?.name ?? invoice.senderName;
  const back = invoice.returnUrl && isReturnLink(invoice.returnUrl) ? invoice.returnUrl : null;
  return (
    <div className="flex flex-col items-start gap-4 p-5 sm:p-6">
      <span className="grid size-10 place-items-center rounded-pill bg-success-soft text-success transition-[opacity,transform] duration-[var(--fw-duration-base)] ease-out starting:scale-90 starting:opacity-0">
        <Check aria-hidden className="size-5" />
      </span>
      <div className="flex flex-col gap-1">
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {tx ? (
          <a href={tx.href} target="_blank" rel="noopener noreferrer" className={LINK}>
            {COPY.viewTx}
          </a>
        ) : null}
        <a href={invoicePdfUrl(invoice.invoiceId, INVOICE_PDFS.receipt)} className={LINK}>
          <FileDown aria-hidden className="size-[var(--fw-icon-sm)]" />
          {COPY.receiptPdf}
        </a>
      </div>
      {back ? (
        <a href={back} rel="noopener noreferrer" className={buttonClasses({ variant: "primary" })}>
          {COPY.backTo(new URL(back).host)}
        </a>
      ) : null}
    </div>
  );
}

// The rules a careful payer may want, out of the way of everyone else.
function NeedHelp({ named }: { named: boolean }) {
  return (
    <details className="text-sm text-muted">
      <summary className="w-fit cursor-pointer rounded-sm outline-none select-none hover:text-ink focus-visible:outline-2 focus-visible:outline-focus">
        {COPY.help}
      </summary>
      <ul className="mt-3 flex flex-col gap-2">
        <li>
          {COPY.host} <strong className="font-medium text-ink">{window.location.host}</strong>.{" "}
          {COPY.hostHint}
        </li>
        {named ? <li>{COPY.unverifiedName}</li> : null}
        <li>{COPY.refund}</li>
        <li>{COPY.scam}</li>
      </ul>
    </details>
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
      <span className="flex flex-col gap-0.5">
        <span className="text-xs text-muted">{COPY.exactAmount}</span>
        <Money
          baseUnits={amount}
          decimals={token.decimals}
          fractionDigits={fractionDigits}
          token={token.symbol}
          className="text-ink"
        />
      </span>
      <Button size="sm" variant="secondary" onClick={copy}>
        {status === COPY_STATUS.copied ? (
          <Check aria-hidden className="size-[var(--fw-icon-sm)]" />
        ) : (
          <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
        )}
        {label}
      </Button>
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
