"use client";

import {
  Badge,
  Button,
  buttonClasses,
  COPY_STATUS,
  cx,
  PAYMENT_STATUS,
  QrCode,
  Spinner,
  StatusPill,
  TONES,
  useCopy,
} from "@forwend/ui-web";
import { Check, Clock, Copy, ReceiptText, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { formatUsd } from "@/features/balances/lib/balances";
import { CheckoutActions } from "@/features/checkout/components/checkout-actions";
import { SaleCard } from "@/features/checkout/components/sale-card";
import { CHECKOUT_COPY as COPY } from "@/features/checkout/constants/checkout-copy";
import type { CheckoutSession } from "@/features/checkout/types/checkout";
import { ConfirmingStatus } from "@/features/invoices/components/invoice-progress";
import { useGetPaymentQuery } from "@/features/payments/api/payments-api";
import { paymentDisplayStatus, paymentLabel } from "@/features/payments/lib/payments";
import type { PaymentDeposit, PaymentDetail } from "@/features/payments/types/payments";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { API_DEPOSIT_STATUSES } from "@/shared/constants/payment-state";
import { chainName } from "@/shared/lib/chains";

// The customer is standing there: check often, and stop once the sale is decided.
const POLL_MS = 3_000;
const DONE = new Set<string>([
  PAYMENT_STATUS.paid,
  PAYMENT_STATUS.overpaid,
  PAYMENT_STATUS.expired,
  PAYMENT_STATUS.expiredPartiallyPaid,
  PAYMENT_STATUS.canceled,
]);
// The only statuses that show the QR code: the sale can take money and none is on its way. Every other one, unknown
// ones too, may have money arriving, and a second scan would make the customer pay twice.
const SCAN = new Set<string>([PAYMENT_STATUS.open, PAYMENT_STATUS.partiallyPaid]);
// A terminal's main button: taller than a form's.
const MAIN = "h-14! w-full";

export interface CheckoutLiveProps {
  profileId: string;
  session: CheckoutSession;
  amountUsd: string;
  onNewSale: () => void;
}

/** The screen the customer sees: the amount and one QR code, then the payment seen, then Paid. */
export function CheckoutLive({ profileId, session, amountUsd, onNewSale }: CheckoutLiveProps) {
  const [done, setDone] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const read = useGetPaymentQuery(
    { profileId, paymentId: session.payment.paymentId },
    { pollingInterval: done ? 0 : POLL_MS, skipPollingIfUnfocused: false },
  );
  const payment = read.currentData ?? session.payment;
  const status = paymentDisplayStatus(payment);
  if (DONE.has(status) !== done) setDone(DONE.has(status));
  const url = payment.hostedUrl ?? "";
  const [copied, copy] = useCopy(url);
  const paid = status === PAYMENT_STATUS.paid || status === PAYMENT_STATUS.overpaid;
  const partial = status === PAYMENT_STATUS.partiallyPaid;
  const scan = SCAN.has(status);
  const usd = formatUsd(usdToCents(amountUsd));
  // Until the customer has picked among several tokens, the network the money comes on isn't known.
  const via =
    payment.optionLocked || payment.optionCount === 1
      ? COPY.via(payment.symbol, chainName(payment.chainId))
      : null;

  // The form that started the sale, or a button a new step took away, is gone: focus moves to the sale's name.
  const step = useRef<string | null>(null);
  useEffect(() => {
    if (step.current === status) return;
    step.current = status;
    if (document.activeElement === document.body) heading.current?.focus();
  }, [status]);

  let body: ReactNode;
  let foot: ReactNode;
  if (scan) {
    body = (
      <>
        {payment.storeName ? <p className="text-sm text-muted">{payment.storeName}</p> : null}
        <Usd value={usd} />
        {url ? (
          <>
            <QrCode
              value={url}
              label={COPY.scan}
              className="w-full max-w-[18.75rem] rounded-xl! border border-line p-4"
            />
            <p className="text-sm font-medium text-ink">{COPY.scanHint}</p>
          </>
        ) : null}
      </>
    );
    foot = (
      <>
        <Strip
          warning={partial}
          sub={COPY.closes(
            new Date(payment.closesAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            }),
          )}
        >
          {partial ? COPY.partial : COPY.waiting}
        </Strip>
        {url ? (
          <Button variant="secondary" className="w-full" onClick={() => void copy()}>
            {copied === COPY_STATUS.copied ? (
              <Check aria-hidden className="size-[var(--fw-icon-sm)]" />
            ) : (
              <Copy aria-hidden className="size-[var(--fw-icon-sm)]" />
            )}
            {copied === COPY_STATUS.copied ? COPY.copied : COPY.copyLink}
          </Button>
        ) : null}
      </>
    );
  } else if (!done) {
    const deposit = slowestDeposit(read.currentData);
    const total = deposit ? Math.max(deposit.blocksTotal, deposit.blocksLeft) : 0;
    body = (
      <>
        <span aria-hidden className="mb-2">
          <Spinner size="3xl" />
        </span>
        <p className="text-2xl font-semibold text-ink">{COPY.seen}</p>
        <Usd value={usd} small />
        {via ? <p className="text-sm text-muted">{via}</p> : null}
        <div className="mt-3 flex w-60 max-w-full flex-col items-center gap-2">
          <span aria-hidden className="block h-1 w-full overflow-hidden rounded-pill bg-line">
            <span
              className="block h-full rounded-pill bg-accent"
              style={{
                width: `${total ? ((total - (deposit?.blocksLeft ?? 0)) / total) * 100 : 0}%`,
              }}
            />
          </span>
          <ConfirmingStatus
            blocks={deposit?.blocksLeft}
            total={deposit?.blocksTotal}
            seconds={deposit?.secondsLeft}
          />
        </div>
      </>
    );
    foot = <Strip warning>{COPY.wait}</Strip>;
  } else if (paid) {
    body = (
      <>
        <span className="mb-1 grid size-[6.5rem] place-items-center rounded-pill bg-success text-success-soft">
          <Check aria-hidden strokeWidth={2.5} className="size-[3.25rem]" />
        </span>
        <p className="text-4xl font-semibold tracking-tight text-success">{COPY.paid}</p>
        <Usd value={usd} small />
        <p className="font-medium text-ink">{COPY.handOver}</p>
        {via ? <p className="text-sm text-muted">{via}</p> : null}
      </>
    );
    foot = (
      <>
        <Button size="lg" className={MAIN} onClick={onNewSale}>
          {COPY.newSale}
        </Button>
        <Link
          href={`${APP_ROUTES.payments}/${payment.paymentId}`}
          className={cx(buttonClasses({ variant: "ghost" }), "w-full")}
        >
          <ReceiptText aria-hidden className="size-[var(--fw-icon-sm)]" />
          {COPY.openPayment}
        </Link>
      </>
    );
  } else {
    body = (
      <>
        <span className="grid size-16 place-items-center rounded-pill border border-line bg-surface-2">
          <Clock aria-hidden className="size-[var(--fw-icon-lg)] text-muted" />
        </span>
        <p className="text-2xl font-semibold text-ink">{COPY.closed}</p>
        <StatusPill status={status} />
        <Usd value={usd} small muted />
      </>
    );
    foot = (
      <Button size="lg" className={MAIN} onClick={onNewSale}>
        {COPY.newSale}
      </Button>
    );
  }

  return (
    <section aria-labelledby="checkout-scan" className="min-w-0">
      <SaleCard
        step={status}
        paid={paid}
        bar={
          <>
            {/* Cancel sale, while it shows, sits at the bar's start; the sale's name at its end. */}
            <h2
              id="checkout-scan"
              ref={heading}
              tabIndex={-1}
              className="ml-auto min-w-0 truncate text-sm text-muted outline-none"
            >
              {paymentLabel(payment)}
            </h2>
            {payment.livemode ? null : <Badge tone={TONES.warning}>{COPY.testMode}</Badge>}
            <CheckoutActions
              profileId={profileId}
              paymentId={payment.paymentId}
              cancelable={status === PAYMENT_STATUS.open}
              sale
              onDone={() => heading.current?.focus()}
            />
          </>
        }
        foot={foot}
      >
        {body}
      </SaleCard>
      {/* Outside the steps, so it stays mounted and each change is read out. */}
      <p role="status" className="sr-only">
        {paid
          ? COPY.status.paid
          : done
            ? COPY.status.closed
            : partial
              ? COPY.status.partial
              : scan
                ? COPY.status.waiting
                : COPY.status.seen}
      </p>
    </section>
  );
}

/** The sale's amount at one size, cents included, so 12.50 can't be read as 12. Long amounts step down to fit. */
function Usd({
  value,
  small = false,
  muted = false,
}: {
  value: string;
  small?: boolean;
  /** A closed sale's amount: nothing more will come of it. */
  muted?: boolean;
}) {
  const size = small
    ? "text-3xl"
    : value.length > 11
      ? "text-3xl"
      : value.length > 8
        ? "text-4xl"
        : "text-5xl";
  return (
    <p
      data-money
      className={cx(
        "flex max-w-full flex-wrap items-baseline justify-center gap-x-2 font-medium tracking-[-0.04em] break-all tabular-nums",
        muted ? "text-subtle" : "text-ink",
        size,
      )}
    >
      {value}
      <span className={cx("font-normal tracking-normal text-muted", small ? "text-lg" : "text-xl")}>
        {MONEY_COPY.usd}
      </span>
    </p>
  );
}

/** One line for the merchant under the customer's part: what the sale waits for, and when it closes. */
function Strip({
  warning = false,
  sub,
  children,
}: {
  warning?: boolean;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "flex items-center gap-2.5 rounded-lg px-3.5 py-3 text-left text-sm font-medium",
        warning ? "bg-warning-soft text-warning" : "bg-surface-2 text-ink",
      )}
    >
      {warning ? (
        <TriangleAlert aria-hidden className="size-[var(--fw-icon-sm)] shrink-0" />
      ) : (
        <span
          aria-hidden
          className="relative mx-1 size-2 shrink-0 rounded-pill bg-accent before:absolute before:inset-0 before:rounded-pill before:bg-accent motion-safe:before:animate-[fw-halo_calc(var(--fw-duration-slower)*2)_var(--fw-ease-out)_infinite]"
        />
      )}
      <span className="min-w-0 flex-1">
        {children}
        {sub ? (
          <span className={cx("block text-xs font-normal", warning ? undefined : "text-muted")}>
            {sub}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** The seen transfer with the most blocks to go: the payment is final when it is. */
function slowestDeposit(payment: PaymentDetail | undefined): PaymentDeposit | undefined {
  return payment?.options
    .flatMap((option) => option.deposits)
    .filter((d) => !d.late && d.status === API_DEPOSIT_STATUSES.detected)
    .reduce<PaymentDeposit | undefined>(
      (most, d) => (most && most.blocksLeft >= d.blocksLeft ? most : d),
      undefined,
    );
}

/** "12.5" → 1250n: the form checked the amount, so it has at most two decimals. */
function usdToCents(usd: string): bigint {
  const [whole = "0", fraction = ""] = usd.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
