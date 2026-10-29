"use client";

import { Badge, Card, EmptyState, Skeleton } from "@forwend/ui-web";
import { ChevronRight, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatUsd } from "@/features/balances/lib/balances";
import { useGetPaymentsInfiniteQuery } from "@/features/payments/api/payments-api";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { PAYMENTS_COPY } from "@/features/payments/constants/payments-copy";
import { paymentLabel, paymentState } from "@/features/payments/lib/payments";
import type { Payment } from "@/features/payments/types/payments";
import { BUSINESS_COPY as COPY } from "@/screens/dashboard/constants/business-copy";
import { LoadError } from "@/shared/components/load-error";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { API_PAYMENT_STATES, API_WALLET_STATES } from "@/shared/constants/payment-state";

const SHOWN = 3;

const LEGEND = [
  { key: "moving", dot: "bg-ink", label: COPY.legendMoving },
  { key: "notFinal", dot: "bg-line-strong", label: COPY.legendNotFinal },
] as const;

export interface OnItsWayCardProps {
  profileId: string;
  /** Paid money moving to the wallet, in cents at market prices. */
  moving: bigint | null;
  /** Confirming or partly paid money, in cents at market prices: may still turn out to be the payer's. */
  notFinal: bigint | null;
  /** Money held for payers, in cents at market prices: theirs, shown apart. */
  held: bigint | null;
}

/** What is coming but not yet in the wallet: payments still confirming, then paid money on its way. */
export function OnItsWayCard({ profileId, moving, notFinal, held }: OnItsWayCardProps) {
  const pendingTotal = (moving ?? 0n) + (notFinal ?? 0n);
  const confirming = useGetPaymentsInfiniteQuery(
    { profileId, filters: { state: API_PAYMENT_STATES.confirming } },
    LIVE_QUERY,
  );
  const pending = useGetPaymentsInfiniteQuery(
    { profileId, filters: { wallet: API_WALLET_STATES.pending } },
    LIVE_QUERY,
  );
  const waiting = confirming.currentData?.pages[0]?.items ?? [];
  const settling = pending.currentData?.pages[0]?.items ?? [];
  const rows = [...waiting, ...settling].slice(0, SHOWN);
  const failed =
    (confirming.isError && !confirming.currentData) || (pending.isError && !pending.currentData);
  const loading = !failed && (!confirming.currentData || !pending.currentData);
  // Only the first page is read, so a full page means "at least": the card never claims an exact count it lacks.
  const more = Boolean(confirming.hasNextPage || pending.hasNextPage);
  const count = waiting.length + settling.length;
  const shown = (n: number, partial: boolean) => (partial ? `${n}+` : String(n));
  return (
    <Card
      id="on-its-way"
      title={COPY.onItsWay}
      action={
        count ? (
          <span className="text-xs text-muted">{COPY.payments(shown(count, more))}</span>
        ) : undefined
      }
      className="flex flex-col"
    >
      {pendingTotal > 0n ? (
        // How much is not in the wallet yet, split by how sure it is: moving is paid; not final may still be the payer's.
        <div className="mb-4">
          <p className="flex items-baseline gap-1.5">
            <span className="text-2xl font-medium tracking-tight text-ink tabular-nums">
              {formatUsd(pendingTotal)}
            </span>
            <span className="text-sm text-muted">{MONEY_COPY.usd}</span>
          </p>
          <div aria-hidden className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-sm">
            {[moving ?? 0n, notFinal ?? 0n].map((cents, i) =>
              cents > 0n ? (
                <span
                  key={LEGEND[i]?.key}
                  className={LEGEND[i]?.dot}
                  style={{ flexGrow: Number((cents * 1000n) / pendingTotal) }}
                />
              ) : null,
            )}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {[moving ?? 0n, notFinal ?? 0n].map((cents, i) => (
              <li key={LEGEND[i]?.key} className="flex items-center gap-1.5">
                <span aria-hidden className={`size-2 rounded-pill ${LEGEND[i]?.dot}`} />
                {LEGEND[i]?.label} <span className="text-ink tabular-nums">{formatUsd(cents)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {failed ? (
        <LoadError
          message={COPY.waysFailed}
          onRetry={() => {
            void confirming.refetch();
            void pending.refetch();
          }}
        />
      ) : loading ? (
        <Skeleton className="h-16" />
      ) : waiting.length ? (
        <Status
          spinning
          title={COPY.confirming(shown(waiting.length, Boolean(confirming.hasNextPage)))}
          note={COPY.confirmingNote}
        />
      ) : settling.length || (moving !== null && moving > 0n) ? (
        <Status
          title={COPY.moving}
          note={COPY.movingNote(moving === null ? "—" : formatUsd(moving))}
          icon={
            <Wallet aria-hidden className="mt-0.5 size-[var(--fw-icon-sm)] shrink-0 text-muted" />
          }
        />
      ) : (
        <EmptyState
          compact
          icon={Wallet}
          title={COPY.nothingOnWay}
          description={COPY.nothingOnWayNote}
        />
      )}
      {rows.length ? (
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {rows.map((payment) => (
            <Row key={payment.paymentId} payment={payment} />
          ))}
        </ul>
      ) : null}
      {held !== null && held > 0n ? (
        <Link
          href={APP_ROUTES.balances}
          className="mt-auto flex items-center gap-2 border-t border-line pt-3 text-sm text-muted outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          <ShieldCheck aria-hidden className="size-[var(--fw-icon-sm)] shrink-0" />
          <span className="min-w-0 flex-1">
            {COPY.heldForPayers(formatUsd(held))}
            <span className="block text-xs text-subtle">{COPY.heldNote}</span>
          </span>
          <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)] shrink-0" />
        </Link>
      ) : null}
    </Card>
  );
}

function Status({
  title,
  note,
  spinning,
  icon,
}: {
  title: string;
  note: string;
  spinning?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div role="status" className="flex items-start gap-2.5">
      {spinning ? (
        <span
          aria-hidden
          data-motion="essential"
          className="mt-1 size-4 shrink-0 animate-[fw-spin_var(--fw-duration-slower)_linear_infinite] rounded-pill border-2 border-[color-mix(in_oklab,var(--fw-accent)_25%,transparent)] border-t-accent"
        />
      ) : (
        icon
      )}
      <div>
        <p className="font-medium text-ink">{title}</p>
        <p className="text-sm text-muted">{note}</p>
      </div>
    </div>
  );
}

function Row({ payment }: { payment: Payment }) {
  return (
    <li className="relative flex items-center gap-3 py-2.5 text-sm">
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <Link
            href={`${APP_ROUTES.payments}/${payment.paymentId}`}
            className="block truncate font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:outline-focus"
          >
            {paymentLabel(payment)}
          </Link>
          {payment.livemode ? null : <Badge tone="neutral">{PAYMENTS_COPY.testnet}</Badge>}
        </span>
        <span className="block truncate text-xs text-muted">{paymentState(payment)}</span>
      </span>
      <PaymentAmount
        amount={payment.amount}
        decimals={payment.decimals}
        symbol={payment.optionCount > 1 ? MONEY_COPY.usd : payment.symbol}
        className="shrink-0 text-ink"
      />
    </li>
  );
}
