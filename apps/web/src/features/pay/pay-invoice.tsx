"use client";

import {
  Button,
  buttonClasses,
  COPY_STATUS,
  formatTokenAmount,
  Money,
  NetworkWarning,
  PAYMENT_STATUS,
  QrCode,
  ReceiveAddress,
  Skeleton,
  StatusPill,
  useCopy,
} from "@forwend/ui-web";
import {
  Check,
  Clock,
  Copy,
  FileDown,
  Globe,
  Info,
  Landmark,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { notFound } from "next/navigation";
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { CheckStatus } from "@/features/invoices/components/check-status";
import { InvoiceDeposits } from "@/features/invoices/components/invoice-deposits";
import { ConfirmingStatus, InvoiceTimeline } from "@/features/invoices/components/invoice-progress";
import {
  exactDigits,
  formatDueDate,
  INVOICE_PDFS,
  type Invoice,
  invoiceNumber,
  invoicePdfUrl,
  invoiceProgress,
  invoiceStatus,
} from "@/features/invoices/invoices";
import { useGetInvoiceQuery } from "@/features/invoices/invoices-api";
import {
  checkoutClosesAt,
  PAY_METHODS,
  PAY_STATES,
  type PayMethod,
  type PayToken,
  payState,
  payToken,
  receiptDeposits,
  shortDuration,
  withOption,
} from "@/features/pay/pay";
import { PAY_COPY as COPY } from "@/features/pay/pay-copy";
import { checkedReceiveAddress } from "@/features/pay/receive-address";
import { chainName, isTestnet } from "@/shared/chains/chains";
import { ExplorerLink } from "@/shared/chains/explorer-link";
import { TokenMark } from "@/shared/chains/token-mark";
import { LIVE_QUERY } from "@/shared/config/refresh";

const NOT_FOUND = 404;
const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const PANEL = "rounded-md border border-line bg-surface";
const PANEL_TITLE = "border-b border-line px-4 py-3 text-base font-semibold text-ink sm:px-5";
const ICON = "mt-0.5 size-[var(--fw-icon-md)] shrink-0";
// Exchange withdrawals often take this long; money after the close is held for the payer, not paid.
const CLOSING_SOON_MS = 30 * 60_000;
const PDF_LINK = `${buttonClasses({ variant: "secondary", size: "sm" })} self-start`;

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
            className="flex flex-wrap items-center gap-3 rounded-md bg-warning-soft px-4 py-3 text-sm text-warning"
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
    <div aria-busy="true" className="flex flex-col gap-4">
      <span role="status" className="sr-only">
        {COPY.loading}
      </span>
      <Skeleton className="h-24" />
      <Skeleton className="h-56" />
    </div>
  );
}

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
  const invoice = useMemo(() => withOption(answer, option), [answer, option]);
  const address = useMemo(
    () => checkedReceiveAddress(invoice, linkInvoiceId),
    [invoice, linkInvoiceId],
  );
  const token = payToken(invoice);
  const issuer = invoice.issuer?.name;
  // Who asks: the issuer, else a request's sender, else the page names only the invoice.
  const sender = issuer ? null : invoice.senderName;
  const number = invoiceNumber(invoice.number);

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl break-words text-ink sm:text-4xl">
          {issuer ??
            (sender
              ? token
                ? COPY.requests(sender, formatMoney(BigInt(invoice.amount), token))
                : sender
              : COPY.invoice(number))}
        </h1>
        <p className="break-words text-muted">
          {[issuer ? COPY.invoice(number) : sender ? COPY.request(number) : null, invoice.title]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="text-sm text-muted">
          {issuer || sender ? COPY.unverifiedName : COPY.noIssuer}
        </p>
        <a
          href={invoicePdfUrl(invoice.invoiceId, INVOICE_PDFS.invoice)}
          className={`${PDF_LINK} mt-2`}
        >
          <FileDown aria-hidden className="size-[var(--fw-icon-sm)]" />
          {COPY.invoicePdf}
        </a>
      </header>
      {address && token ? (
        <Checkout invoice={invoice} address={address} token={token} now={now} />
      ) : (
        <p
          role="alert"
          className="flex items-start gap-3 rounded-md bg-danger-soft px-4 py-3 text-danger"
        >
          <ShieldAlert aria-hidden className={ICON} />
          {address ? COPY.unknownToken : COPY.mismatch}
        </p>
      )}
    </>
  );
}

function Checkout({
  invoice,
  address,
  token,
  now,
}: {
  invoice: Invoice;
  address: string;
  token: PayToken;
  now: number;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [method, setMethod] = useState<PayMethod | null>(null);
  const networkHeading = useRef<HTMLHeadingElement>(null);
  const methodHeading = useRef<HTMLHeadingElement>(null);
  const sendHeading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  // Focus follows the step that just opened, so keyboard and screen-reader users land on it; not on page load.
  useEffect(() => {
    if (mounted.current)
      (confirmed ? (method ? sendHeading : methodHeading) : networkHeading).current?.focus();
    mounted.current = true;
  }, [confirmed, method]);

  const network = chainName(invoice.chainId);
  const amount = BigInt(invoice.amount);
  const money = (units: bigint) => formatMoney(units, token);
  const pay = payState(invoice, now);
  const due = money(pay.remaining);
  const expiresAt = checkoutClosesAt(invoice);
  const status =
    pay.state === PAY_STATES.closed
      ? PAYMENT_STATUS.expired
      : pay.state === PAY_STATES.closedPartial
        ? PAYMENT_STATUS.expiredPartiallyPaid
        : invoiceStatus(invoice);
  // Partly paid: the big figure is what is left, the one a payer copies; the total moves to a row.
  const partial = pay.canSend && pay.received > 0n;
  const shown = partial ? pay.remaining : amount;
  const closingSoon = expiresAt - now < CLOSING_SOON_MS;

  return (
    <>
      <section aria-labelledby="pay-amount" className={PANEL}>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="pay-amount" className="text-sm text-muted">
              {pay.state === PAY_STATES.paid || pay.state === PAY_STATES.settled
                ? COPY.amountPaid
                : partial
                  ? COPY.leftToPay
                  : pay.canSend
                    ? COPY.amountDue
                    : COPY.invoiceTotal}
            </h2>
            <StatusPill status={status} />
          </div>
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <Money
              baseUnits={shown}
              decimals={token.decimals}
              fractionDigits={exactDigits(shown, token.decimals)}
              token={token.symbol}
              className="min-w-0 text-amount-lg text-ink"
            />
            <TokenMark chainId={invoice.chainId} symbol={token.symbol} />
          </div>
        </div>
        <dl className="divide-y divide-line">
          {partial ? (
            <>
              <Row term={COPY.invoiceTotal}>{money(amount)}</Row>
              <Row term={COPY.receivedSoFar}>{money(pay.received)}</Row>
            </>
          ) : null}
          {invoice.dueDate ? <Row term={COPY.dueDate}>{formatDueDate(invoice.dueDate)}</Row> : null}
          {/* Once paid the checkout no longer matters to the payer; a countdown would read as still open. */}
          {pay.state === PAY_STATES.paid || pay.state === PAY_STATES.settled ? null : (
            <Row term={COPY.closes}>
              {TIME.format(expiresAt)}
              <span className="text-muted">
                {" · "}
                {pay.closed ? COPY.closedNow : COPY.closesIn(shortDuration(expiresAt - now))}
              </span>
            </Row>
          )}
          {invoice.note ? (
            <Row term={COPY.note} stacked>
              {invoice.note}
            </Row>
          ) : null}
        </dl>
      </section>

      {pay.state === PAY_STATES.settled ? <Receipt invoice={invoice} token={token} /> : null}

      {isTestnet(invoice.chainId) ? (
        <p
          role="note"
          className="flex items-start gap-3 rounded-md bg-info-soft px-4 py-3 text-sm text-info"
        >
          <Info aria-hidden className={ICON} />
          {COPY.testnet(network, token.symbol)}
        </p>
      ) : null}

      {/* One step at a time, like a checkout: confirm the network, pick how to pay, then the address. The address
          appears only after the network is confirmed (R-45); a finished step folds into its choice with Change. */}
      {pay.canSend ? (
        <>
          <Step
            id="pay-before"
            number={1}
            title={COPY.stepNetwork}
            state={confirmed ? STEP.done : STEP.current}
            summary={COPY.pair(token.symbol, network)}
            headingRef={networkHeading}
            changeLabel={COPY.changeNetwork}
            onChange={() => setConfirmed(false)}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-ink px-4 py-3">
              <TokenMark chainId={invoice.chainId} symbol={token.symbol} />
              <span className="text-xs text-muted">{COPY.onlyOption}</span>
            </div>
            <ul className="-mx-4 my-4 divide-y divide-line border-y border-line text-sm text-ink sm:-mx-5">
              <Item icon={<Globe aria-hidden className={ICON} />}>
                {COPY.host} <strong className="font-semibold">{window.location.host}</strong>.{" "}
                <span className="text-muted">{COPY.hostHint}</span>
              </Item>
              <Item icon={<RotateCcw aria-hidden className={ICON} />}>{COPY.refund}</Item>
              <Item icon={<ShieldCheck aria-hidden className={ICON} />}>{COPY.scam}</Item>
            </ul>
            <div className="flex flex-col gap-4">
              <NetworkWarning token={token.symbol} network={network} />
              <div className="flex flex-col gap-2">
                <Button size="lg" className="w-full" onClick={() => setConfirmed(true)}>
                  {COPY.confirm(token.symbol, network)}
                </Button>
                <p className="text-center text-xs text-muted">{COPY.confirmHint}</p>
              </div>
            </div>
          </Step>
          <Step
            id="pay-method"
            number={2}
            title={COPY.how}
            headingRef={methodHeading}
            state={!confirmed ? STEP.upcoming : method ? STEP.done : STEP.current}
            summary={method ? COPY.methods[method].label : ""}
            changeLabel={COPY.changeMethod}
            onChange={() => setMethod(null)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.values(PAY_METHODS).map((m) => {
                const Icon = METHOD_ICONS[m];
                return (
                  <button
                    key={m}
                    type="button"
                    data-method={m}
                    onClick={() => setMethod(m)}
                    className="flex items-start gap-3 rounded-md border border-line-strong bg-surface p-4 text-left transition-colors duration-[var(--fw-duration-fast)] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <Icon aria-hidden className={`${ICON} text-muted`} />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium text-ink">{COPY.methods[m].label}</span>
                      <span className="text-sm text-muted">{COPY.methods[m].hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Step>
          <Step
            id="pay-send"
            number={3}
            title={COPY.send}
            headingRef={sendHeading}
            state={confirmed && method ? STEP.current : STEP.upcoming}
          >
            {method ? (
              <div className="flex flex-col gap-4">
                {/* Only an exchange withdrawal can outlast the checkout; a wallet transfer is seconds. */}
                {closingSoon && method === PAY_METHODS.exchange ? (
                  <p
                    role="note"
                    className="flex items-start gap-3 rounded-md bg-warning-soft px-4 py-3 text-sm text-warning"
                  >
                    <Clock aria-hidden className={ICON} />
                    {COPY.closingSoon}
                  </p>
                ) : null}
                <SendTo
                  amount={pay.remaining}
                  token={token}
                  steps={
                    method === PAY_METHODS.wallet
                      ? COPY.walletSteps(due, network)
                      : COPY.exchangeSteps(due, token.symbol, network)
                  }
                  address={address}
                  label={COPY.address(token.symbol, network)}
                />
              </div>
            ) : null}
          </Step>
        </>
      ) : null}

      <Status invoice={invoice} pay={pay} network={network} money={money} token={token} />
    </>
  );
}

function Status({
  invoice,
  pay,
  network,
  money,
  token,
}: {
  invoice: Invoice;
  pay: ReturnType<typeof payState>;
  network: string;
  money: (units: bigint) => string;
  token: PayToken;
}) {
  const { blocksLeft, secondsLeft } = invoiceProgress(invoice);
  // A closed checkout waits for nothing more, even before the API marks it expired.
  const waiting = pay.state !== PAY_STATES.closed && pay.state !== PAY_STATES.closedPartial;
  return (
    <section aria-labelledby="pay-status" className={PANEL}>
      <h2 id="pay-status" className={PANEL_TITLE}>
        {COPY.status}
      </h2>
      <div className="flex flex-col gap-3 px-4 py-4 text-sm text-ink sm:px-5 sm:py-5">
        <InvoiceTimeline invoice={invoice} label={COPY.progress} waiting={waiting} />
        <p role="status">
          {pay.state === PAY_STATES.confirming ? (
            <ConfirmingStatus blocks={blocksLeft} seconds={secondsLeft} />
          ) : (
            COPY.states[pay.state]({
              network,
              received: money(pay.received),
              remaining: money(pay.remaining),
            })
          )}
        </p>
        {pay.extra > 0n ? <p className="text-warning">{COPY.extra(money(pay.extra))}</p> : null}
        {pay.late > 0n ? <p className="text-warning">{COPY.late(money(pay.late))}</p> : null}
        <InvoiceDeposits invoice={invoice} token={token} />
        {/* Paid or settled, nothing is left for the payer to look for. */}
        {pay.state === PAY_STATES.paid || pay.state === PAY_STATES.settled ? null : (
          <CheckStatus invoiceId={invoice.invoiceId} network={network} money={money} />
        )}
      </div>
    </section>
  );
}

function Receipt({ invoice, token }: { invoice: Invoice; token: PayToken }) {
  const amount = BigInt(invoice.amount);
  const deposits = receiptDeposits(invoice);
  return (
    <section aria-labelledby="pay-receipt" className={PANEL}>
      <h2 id="pay-receipt" className={PANEL_TITLE}>
        {COPY.receipt}
      </h2>
      <dl className="divide-y divide-line">
        <Row term={COPY.amountPaid}>
          <Money
            baseUnits={amount}
            decimals={token.decimals}
            fractionDigits={exactDigits(amount, token.decimals)}
            token={token.symbol}
          />
        </Row>
        {invoice.paidAt ? (
          <Row term={COPY.paidAt}>{TIME.format(Date.parse(invoice.paidAt))}</Row>
        ) : null}
        {invoice.settledAt ? (
          <Row term={COPY.settledAt}>{TIME.format(Date.parse(invoice.settledAt))}</Row>
        ) : null}
        {deposits.length > 0 ? (
          <Row term={COPY.paymentTx(deposits.length)} stacked>
            {deposits.map((d) => (
              <TxHash key={`${d.txHash}:${d.logIndex}`} chainId={invoice.chainId} hash={d.txHash} />
            ))}
          </Row>
        ) : null}
        {invoice.settlementTxHash ? (
          <Row term={COPY.settlementTx} stacked>
            <TxHash chainId={invoice.chainId} hash={invoice.settlementTxHash} />
          </Row>
        ) : null}
      </dl>
      <div className="flex border-t border-line px-4 py-4 sm:px-5">
        <a href={invoicePdfUrl(invoice.invoiceId, INVOICE_PDFS.receipt)} className={PDF_LINK}>
          <FileDown aria-hidden className="size-[var(--fw-icon-sm)]" />
          {COPY.receiptPdf}
        </a>
      </div>
    </section>
  );
}

function TxHash({ chainId, hash }: { chainId: number; hash: string }) {
  return (
    <span className="flex flex-col items-start">
      <span className="font-mono text-xs break-all">{hash}</span>
      <ExplorerLink chainId={chainId} txHash={hash} named className="-ml-1" />
    </span>
  );
}

const STEP = { current: "current", done: "done", upcoming: "upcoming" } as const;
type StepState = (typeof STEP)[keyof typeof STEP];

const METHOD_ICONS: Record<PayMethod, typeof Wallet> = {
  [PAY_METHODS.wallet]: Wallet,
  [PAY_METHODS.exchange]: Landmark,
};

// A numbered checkout step: open while current, folded to its choice with Change once done, a muted title before.
function Step({
  id,
  number,
  title,
  state,
  summary,
  changeLabel,
  onChange,
  headingRef,
  children,
}: {
  id: string;
  number: number;
  title: string;
  state: StepState;
  summary?: string;
  changeLabel?: string;
  onChange?: () => void;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={PANEL}>
      <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <span
          aria-hidden
          className={`grid size-6 shrink-0 place-items-center rounded-pill text-xs font-medium ${
            state === STEP.done
              ? "bg-primary text-on-primary"
              : state === STEP.current
                ? "border-2 border-accent text-accent"
                : "border border-line-strong text-subtle"
          }`}
        >
          {state === STEP.done ? <Check className="size-[var(--fw-icon-sm)]" /> : number}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2
            id={id}
            ref={headingRef}
            tabIndex={-1}
            className={`text-base font-semibold focus-visible:outline-none ${state === STEP.upcoming ? "text-subtle" : "text-ink"}`}
          >
            {title}
            {state === STEP.done ? <span className="sr-only">{COPY.stepDone}</span> : null}
          </h2>
          {/* The choice sits under the title, so a phone never cuts it. */}
          {state === STEP.done ? <p className="truncate text-sm text-muted">{summary}</p> : null}
        </div>
        {state === STEP.done ? (
          <button
            type="button"
            data-change
            aria-label={changeLabel}
            onClick={onChange}
            className="-mr-2 inline-flex h-11 shrink-0 items-center rounded-sm px-2 text-sm text-accent hover:underline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {COPY.change}
          </button>
        ) : null}
      </div>
      {state === STEP.current ? (
        <div className="border-t border-line px-4 py-4 sm:px-5 sm:py-5">{children}</div>
      ) : null}
    </section>
  );
}

function SendTo({
  amount,
  token,
  steps,
  address,
  label,
}: {
  amount: bigint;
  token: PayToken;
  steps: readonly string[];
  address: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Plain numbers: circled ones would read as more checkout steps inside step 3. */}
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-ink marker:text-muted">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <ExactAmount amount={amount} token={token} />
      <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
        {/* A payer on this phone cannot scan its own screen: Copy comes first there. */}
        <QrCode
          value={address}
          label={COPY.qr}
          className="w-40 justify-self-center border border-line max-sm:order-last"
        />
        <ReceiveAddress address={address} label={label} />
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
    <div className="flex flex-wrap items-center justify-between gap-3">
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

function Row({
  term,
  stacked = false,
  children,
}: {
  term: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex gap-x-4 gap-y-0.5 px-4 py-3 text-sm sm:px-5 ${stacked ? "flex-col" : "flex-wrap justify-between"}`}
    >
      <dt className="text-muted">{term}</dt>
      <dd className="break-words whitespace-pre-line text-ink">{children}</dd>
    </div>
  );
}

function Item({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <span className="text-muted">{icon}</span>
      <p>{children}</p>
    </li>
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
