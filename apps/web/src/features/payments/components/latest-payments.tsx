"use client";
import {
  Badge,
  buttonClasses,
  Card,
  EmptyState,
  ROW_INTERACTIVE_CLASSES,
  StatusPill,
} from "@forwend/ui-web";
import { ArrowDownLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useGetPaymentsInfiniteQuery } from "@/features/payments/api/payments-api";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { SOURCE_ICONS, SOURCE_LABELS } from "@/features/payments/constants/payments";
import { PAYMENTS_COPY as COPY } from "@/features/payments/constants/payments-copy";
import { paymentDisplayStatus, paymentLabel } from "@/features/payments/lib/payments";
import type { Payment } from "@/features/payments/types/payments";
import { LoadError } from "@/shared/components/load-error";
import { RowsSkeleton } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { shortDate } from "@/shared/lib/dates";

const SHOWN = 6;

/** The overview's newest customer payments; the same first page the Payments list reads, so no second request. */
export function LatestPayments({ profileId }: { profileId: string }) {
  const list = useGetPaymentsInfiniteQuery({ profileId, filters: {} }, LIVE_QUERY);
  const rows = list.currentData?.pages[0]?.items.slice(0, SHOWN);
  return (
    <Card
      id="latest-payments"
      title={COPY.latest}
      className="flex flex-col"
      action={
        <Link
          href={APP_ROUTES.payments}
          className={`${buttonClasses({ variant: "ghost", size: "sm" })} -mt-1.5 -mr-2`}
        >
          {COPY.viewAll}
          <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)]" />
        </Link>
      }
    >
      <div className="flex min-h-40 flex-1 flex-col">
        {list.isError && !rows ? (
          <LoadError message={COPY.failed} onRetry={() => void list.refetch()} />
        ) : !rows ? (
          <RowsSkeleton count={5} />
        ) : rows.length === 0 ? (
          <EmptyState compact icon={ArrowDownLeft} title={COPY.emptyTitle} />
        ) : (
          <ul className="-mx-4 divide-y divide-line border-t border-line sm:-mx-5">
            {rows.map((p) => (
              <li
                key={p.paymentId}
                className={`relative flex min-h-14 items-center gap-3 px-4 py-2.5 sm:px-5 ${ROW_INTERACTIVE_CLASSES}`}
              >
                <SourceIcon source={p.source} />
                <Link
                  href={`${APP_ROUTES.payments}/${p.paymentId}`}
                  className="min-w-0 flex-1 outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{paymentLabel(p)}</span>
                    {p.livemode ? null : <Badge tone="neutral">{COPY.testnet}</Badge>}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {[
                      p.customerName || p.customerEmail,
                      SOURCE_LABELS[p.source],
                      shortDate(p.createdAt),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Link>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <PaymentAmount
                    amount={p.amount}
                    decimals={p.decimals}
                    symbol={p.optionCount > 1 ? MONEY_COPY.usd : p.symbol}
                    className="text-sm text-ink"
                  />
                  <StatusPill status={paymentDisplayStatus(p)} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function SourceIcon({ source }: { source: Payment["source"] }) {
  const Icon = SOURCE_ICONS[source];
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-pill bg-surface-2 text-muted"
    >
      <Icon className="size-[var(--fw-icon-sm)]" />
    </span>
  );
}
