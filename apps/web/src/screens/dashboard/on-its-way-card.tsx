"use client";

import { Card, PAYMENT_STATUSES, Skeleton } from "@forwend/ui-web";
import { ChevronRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { BALANCE_FIELDS } from "@/features/balances/constants/balances";
import { fieldUnits, marketUsd } from "@/features/balances/lib/balances";
import type { BalanceField, Balances } from "@/features/balances/types/balances";
import { PAYMENT_PARAMS } from "@/features/payments/constants/payments";
import { paymentsHref } from "@/features/payments/lib/payments";
import type { TokenPrice } from "@/features/prices/types/prices";
import { BUSINESS_COPY as COPY } from "@/screens/dashboard/constants/business-copy";
import { LoadError } from "@/shared/components/load-error";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { API_PAYMENT_STATES, API_SETTLEMENT_STATUSES } from "@/shared/constants/payment-state";
import { formatUsd } from "@/shared/lib/money";
import { STATE_STATUS } from "@/shared/lib/payment-state";

// Surest first. Only "settling" matches its Payments list; the others follow ledger bookings.
const PARTS = [
  {
    field: BALANCE_FIELDS.settling,
    dot: "bg-ink",
    label: COPY.legendMoving,
    href: paymentsHref(PAYMENT_PARAMS.settlementStatus, API_SETTLEMENT_STATUSES.pending),
  },
  {
    field: BALANCE_FIELDS.confirming,
    dot: "bg-muted",
    label: PAYMENT_STATUSES[STATE_STATUS[API_PAYMENT_STATES.confirming]].label,
    href: paymentsHref(PAYMENT_PARAMS.state, API_PAYMENT_STATES.confirming),
  },
  {
    field: BALANCE_FIELDS.partial,
    dot: "bg-subtle",
    label: PAYMENT_STATUSES[STATE_STATUS[API_PAYMENT_STATES.partiallyPaid]].label,
    href: paymentsHref(PAYMENT_PARAMS.state, API_PAYMENT_STATES.partiallyPaid),
  },
] as const;

export interface OnItsWayCardProps {
  balances: Balances | null;
  prices: readonly TokenPrice[] | undefined;
  failed: boolean;
  onRetry: () => void;
}

/** What is coming but not in the wallet yet, in USD at market prices, by how sure it is. */
export function OnItsWayCard({ balances, prices, failed, onRetry }: OnItsWayCardProps) {
  // No base units is a real zero, priced or not; otherwise a missing price is unknown, never valued as zero.
  const usd = (field: BalanceField) =>
    !balances
      ? null
      : balances.tokens.every((t) => fieldUnits(t, field) === "0")
        ? 0n
        : marketUsd(balances, field, prices);
  const parts = PARTS.map((part) => ({ ...part, cents: usd(part.field) }));
  const total = parts.every((p) => p.cents !== null)
    ? parts.reduce((n, p) => n + (p.cents ?? 0n), 0n)
    : null;
  const held = usd(BALANCE_FIELDS.held);
  return (
    <Card id="on-its-way" title={COPY.onItsWay} className="flex flex-col">
      {!balances && failed ? (
        <LoadError message={COPY.waysFailed} onRetry={onRetry} />
      ) : (
        <>
          <p className="flex items-baseline gap-1.5">
            <span className="text-2xl font-medium tracking-tight text-ink tabular-nums">
              {!balances ? (
                <Skeleton className="inline-block h-6 w-36 align-middle" />
              ) : total === null ? (
                "—"
              ) : (
                formatUsd(total)
              )}
            </span>
            <span className="text-sm text-muted">{MONEY_COPY.usd}</span>
          </p>
          <div aria-hidden className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-sm">
            {total ? (
              parts.map((p) =>
                p.cents ? (
                  <span
                    key={p.field}
                    className={p.dot}
                    style={{ flexGrow: Number((p.cents * 1000n) / total) }}
                  />
                ) : null,
              )
            ) : (
              <span className="flex-1 bg-line" />
            )}
          </div>
          <ul className="mt-3 divide-y divide-line">
            {parts.map((p) => (
              <li key={p.field}>
                <Part {...p} loading={!balances} />
              </li>
            ))}
          </ul>
          {held !== null && held > 0n ? (
            <Link
              href={APP_ROUTES.balances}
              className="group mt-auto flex items-center gap-3 border-t border-line pt-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-focus"
            >
              <ShieldCheck aria-hidden className="size-[var(--fw-icon-sm)] shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink tabular-nums">
                  {COPY.onHold(formatUsd(held))}
                </span>
                <span className="block text-xs text-muted">{COPY.heldNote}</span>
              </span>
              <ChevronRight
                aria-hidden
                className="size-[var(--fw-icon-sm)] shrink-0 text-muted group-hover:text-ink"
              />
            </Link>
          ) : null}
        </>
      )}
    </Card>
  );
}

const ROW = "flex items-center gap-2.5 py-2.5 text-sm";
const ICON = "size-[var(--fw-icon-sm)] shrink-0";

function Part({
  dot,
  label,
  href,
  cents,
  loading,
}: {
  dot: string;
  label: string;
  href: string;
  cents: bigint | null;
  loading: boolean;
}) {
  const body = (
    <>
      <span aria-hidden className={`size-2 shrink-0 rounded-pill ${dot}`} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {loading ? (
        <Skeleton className="h-4 w-16" />
      ) : (
        <span className="tabular-nums">
          {cents === null ? "—" : formatUsd(cents)}
          <span className="sr-only"> {MONEY_COPY.usd}</span>
        </span>
      )}
    </>
  );
  if (loading || cents === 0n)
    return (
      <div className={`${ROW} text-muted`}>
        {body}
        <span aria-hidden className={ICON} />
      </div>
    );
  return (
    <Link
      href={href}
      className={`group ${ROW} text-ink outline-none focus-visible:outline-2 focus-visible:outline-focus`}
    >
      {body}
      <ChevronRight aria-hidden className={`${ICON} text-muted group-hover:text-ink`} />
    </Link>
  );
}
