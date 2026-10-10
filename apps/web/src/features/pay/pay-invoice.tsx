"use client";

import {
  Button,
  formatTokenAmount,
  Money,
  NetworkWarning,
  PAYMENT_STATUS,
  QrCode,
  ReceiveAddress,
  Skeleton,
  StatusPill,
  Tabs,
} from "@forwend/ui-web";
import { Check, Globe, Info, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { InvoiceDeposits } from "@/features/invoices/invoice-deposits";
import { ConfirmingStatus, InvoiceTimeline } from "@/features/invoices/invoice-progress";
import {
  exactDigits,
  formatDueDate,
  type Invoice,
  invoiceNumber,
  invoiceProgress,
  invoiceStatus,
} from "@/features/invoices/invoices";
import { useGetInvoiceQuery } from "@/features/invoices/invoices-api";
import { PAY_STATES, payState, payToken, shortDuration } from "@/features/pay/pay";
import { PAY_COPY as COPY } from "@/features/pay/pay-copy";
import { checkedReceiveAddress } from "@/features/pay/receive-address";
import { chainName, isTestnet } from "@/shared/chains/chains";
import { TokenMark } from "@/shared/chains/token-mark";
import { LIVE_QUERY } from "@/shared/config/refresh";

const NOT_FOUND = 404;
const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const PANEL = "rounded-md border border-line bg-surface";
const PANEL_TITLE = "border-b border-line px-4 py-3 text-base font-semibold text-ink sm:px-5";
const ICON = "mt-0.5 size-[var(--fw-icon-md)] shrink-0";

// The public read, again every REFRESH_MS while the tab is visible: the payer sees the status move without a reload.
export function PayInvoice({ invoiceId }: { invoiceId: string }) {
  const invoice = useGetInvoiceQuery(invoiceId, LIVE_QUERY);
  const failure = invoice.error as { status?: unknown } | undefined;
  if (invoice.data) return <Loaded invoice={invoice.data} />;
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
    <>
      <Skeleton className="h-24" />
      <Skeleton className="h-56" />
    </>
  );
}

function Loaded({ invoice }: { invoice: Invoice }) {
  const now = useNow();
  const address = useMemo(() => checkedReceiveAddress(invoice), [invoice]);
  const token = payToken(invoice);
  const issuer = invoice.issuer?.name;

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl break-words text-ink sm:text-4xl">
          {issuer ?? COPY.invoice(invoiceNumber(invoice.number))}
        </h1>
        <p className="break-words text-muted">
          {[issuer ? COPY.invoice(invoiceNumber(invoice.number)) : null, invoice.title]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {issuer ? null : <p className="text-sm text-muted">{COPY.noIssuer}</p>}
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
  token: { symbol: string; decimals: number };
  now: number;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const sendHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (confirmed) sendHeading.current?.focus();
  }, [confirmed]);

  const network = chainName(invoice.chainId);
  const amount = BigInt(invoice.amount);
  const money = (units: bigint) =>
    `${formatTokenAmount({ baseUnits: units, decimals: token.decimals, fractionDigits: exactDigits(units, token.decimals) })} ${token.symbol}`;
  const pay = payState(invoice, now);
  const due = money(pay.remaining);
  const expiresAt = Date.parse(invoice.expiresAt);
  const status = pay.state === PAY_STATES.closed ? PAYMENT_STATUS.expired : invoiceStatus(invoice);

  return (
    <>
      <section aria-labelledby="pay-amount" className={PANEL}>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="pay-amount" className="text-sm text-muted">
              {pay.state === PAY_STATES.paid || pay.state === PAY_STATES.settled
                ? COPY.amountPaid
                : COPY.amountDue}
            </h2>
            <StatusPill status={status} />
          </div>
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <Money
              baseUnits={amount}
              decimals={token.decimals}
              fractionDigits={exactDigits(amount, token.decimals)}
              token={token.symbol}
              className="min-w-0 text-amount-lg break-all text-ink"
            />
            <TokenMark chainId={invoice.chainId} symbol={token.symbol} />
          </div>
        </div>
        <dl className="divide-y divide-line">
          {invoice.dueDate ? <Row term={COPY.dueDate}>{formatDueDate(invoice.dueDate)}</Row> : null}
          <Row term={COPY.closes}>
            {TIME.format(expiresAt)}
            <span className="text-muted">
              {" · "}
              {pay.closed ? COPY.closedNow : COPY.closesIn(shortDuration(expiresAt - now))}
            </span>
          </Row>
          {invoice.note ? (
            <Row term={COPY.note} stacked>
              {invoice.note}
            </Row>
          ) : null}
        </dl>
      </section>

      {isTestnet(invoice.chainId) ? (
        <p
          role="note"
          className="flex items-start gap-3 rounded-md bg-info-soft px-4 py-3 text-sm text-info"
        >
          <Info aria-hidden className={ICON} />
          {COPY.testnet(network, token.symbol)}
        </p>
      ) : null}

      {pay.canSend ? (
        <section aria-labelledby="pay-before" className={PANEL}>
          <h2 id="pay-before" className={PANEL_TITLE}>
            {COPY.beforeYouPay}
          </h2>
          <ul className="divide-y divide-line text-sm text-ink">
            <Item icon={<Globe aria-hidden className={ICON} />}>
              {COPY.host} <strong className="font-semibold">{window.location.host}</strong>.{" "}
              <span className="text-muted">{COPY.hostHint}</span>
            </Item>
            <Item icon={<RotateCcw aria-hidden className={ICON} />}>{COPY.refund(due)}</Item>
            <Item icon={<ShieldCheck aria-hidden className={ICON} />}>{COPY.scam}</Item>
          </ul>
          <div className="flex flex-col gap-4 px-4 pb-4 sm:px-5 sm:pb-5">
            <NetworkWarning token={token.symbol} network={network} />
            {confirmed ? (
              <p className="flex items-center gap-2 text-sm font-medium text-success">
                <Check aria-hidden className="size-[var(--fw-icon-md)] shrink-0" />
                {COPY.confirmed(token.symbol, network)}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <Button size="lg" className="w-full" onClick={() => setConfirmed(true)}>
                  {COPY.confirm(token.symbol, network)}
                </Button>
                <p className="text-center text-xs text-muted">{COPY.confirmHint}</p>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {pay.canSend && confirmed ? (
        <section aria-labelledby="pay-send" className={PANEL}>
          <h2
            id="pay-send"
            ref={sendHeading}
            tabIndex={-1}
            className={`${PANEL_TITLE} focus-visible:outline-none`}
          >
            {COPY.send}
          </h2>
          <div className="px-4 py-4 sm:px-5 sm:py-5">
            <Tabs
              label={COPY.how}
              items={[
                {
                  value: "wallet",
                  label: COPY.wallet,
                  content: (
                    <SendTo
                      steps={COPY.walletSteps(due, network)}
                      address={address}
                      label={COPY.address(token.symbol, network)}
                    />
                  ),
                },
                {
                  value: "exchange",
                  label: COPY.exchange,
                  content: (
                    <SendTo
                      steps={COPY.exchangeSteps(due, token.symbol, network)}
                      address={address}
                      label={COPY.address(token.symbol, network)}
                    />
                  ),
                },
              ]}
            />
          </div>
        </section>
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
  token: { symbol: string; decimals: number };
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
      </div>
    </section>
  );
}

function SendTo({
  steps,
  address,
  label,
}: {
  steps: readonly string[];
  address: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-2.5 text-sm text-ink">
        {steps.map((step, i) => (
          <li key={step} className="flex gap-3">
            <span
              aria-hidden
              className="grid size-6 shrink-0 place-items-center rounded-pill bg-surface-2 text-xs font-medium text-muted"
            >
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
      <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
        <QrCode
          value={address}
          label={COPY.qr}
          className="w-40 justify-self-center border border-line"
        />
        <ReceiveAddress address={address} label={label} />
      </div>
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
