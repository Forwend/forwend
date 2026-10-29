"use client";

import {
  Button,
  Card,
  EmptyState,
  formatTokenAmount,
  ROW_INTERACTIVE_CLASSES,
} from "@forwend/ui-web";
import { CircleCheck, FileText } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatUsd } from "@/features/balances/lib/balances";
import { useGetOwedQuery } from "@/features/invoices/api/invoices-api";
import { OWED_KINDS } from "@/features/invoices/constants/invoices";
import { OWED_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { invoiceNumber, owedCents } from "@/features/invoices/lib/invoices";
import type { OwedKind } from "@/features/invoices/types/invoices";
import { InitialsAvatar } from "@/shared/components/initials-avatar";
import { LoadError } from "@/shared/components/load-error";
import { RecordLink } from "@/shared/components/record-link";
import { RowsSkeleton } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { exactDigits } from "@/shared/lib/money";

const SHOWN = 5;

// R-95, D-114: receivables only. Held money is the payer's: it shows as Overpaid on its payment, never as owed.
export function OwedToYou({ profileId }: { profileId: string }) {
  const owed = useGetOwedQuery(profileId, LIVE_QUERY);
  const [all, setAll] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  // Show all goes away once pressed: focus moves to the first row it showed.
  useEffect(() => {
    if (all) list.current?.querySelectorAll("a")[SHOWN]?.focus();
  }, [all]);
  // A row kind a newer API adds is left out until this page knows its words.
  const items = owed.currentData?.items.filter(
    (o) => o.kind !== OWED_KINDS.held && Object.hasOwn(COPY.kinds, o.kind),
  );
  // The API totals every row per token, not only the first page it returns.
  const total = owed.currentData ? owedCents(owed.currentData.totals ?? items ?? []) : 0n;
  const more = Math.max(0, (owed.currentData?.count ?? 0) - (items?.length ?? 0));
  const rows = items && !all ? items.slice(0, SHOWN) : items;

  return (
    <Card
      id="owed-title"
      title={COPY.title}
      description={COPY.description}
      action={
        total > 0n ? (
          <p className="text-sm font-semibold whitespace-nowrap text-ink tabular-nums">
            <span className="sr-only">{COPY.totalLabel}: </span>
            {formatUsd(total)} <span className="font-medium text-muted">{MONEY_COPY.usd}</span>
          </p>
        ) : undefined
      }
      className="flex flex-col"
    >
      {/* One height for every state, so the card beside it never jumps. */}
      <div className="flex min-h-72 flex-1 flex-col">
        {owed.isError && !items ? (
          <LoadError message={COPY.failed} onRetry={() => void owed.refetch()} />
        ) : !rows ? (
          <RowsSkeleton count={5} />
        ) : rows.length === 0 ? (
          <EmptyState compact icon={CircleCheck} title={COPY.none} />
        ) : (
          <ul ref={list} className="-mx-4 divide-y divide-line border-t border-line sm:-mx-5">
            {rows.map((o) => {
              const name = o.clientName ?? o.title ?? o.reference;
              // A checkout has no invoice page: its payment is where the customer's share is.
              const href = o.number
                ? `${APP_ROUTES.invoices}/${o.invoiceId}`
                : `${APP_ROUTES.payments}/${o.invoiceId}`;
              const units = BigInt(o.amount);
              return (
                <li key={`${o.kind}-${o.invoiceId}-${o.chainId}-${o.token}`}>
                  <Link
                    href={href}
                    className={`flex min-h-14 items-center gap-3 px-4 py-2.5 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:px-5 ${ROW_INTERACTIVE_CLASSES}`}
                  >
                    <InitialsAvatar
                      name={o.clientName}
                      small
                      fallback={<FileText className="size-3.5" />}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">
                        {name ?? (o.number ? invoiceNumber(o.number) : COPY.checkout)}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {name && o.number ? `${invoiceNumber(o.number)} · ` : null}
                        <span
                          className={o.kind === OWED_KINDS.overdue ? "text-warning" : undefined}
                        >
                          {COPY.kinds[o.kind as OwedKind](o.daysLate)}
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="whitespace-nowrap text-ink tabular-nums">
                        {formatTokenAmount({
                          baseUnits: units,
                          decimals: o.decimals,
                          fractionDigits: exactDigits(units, o.decimals),
                        })}{" "}
                        <span className="text-sm text-muted">
                          {o.optionCount > 1 ? MONEY_COPY.usd : o.symbol}
                        </span>
                      </span>
                      <span className="text-xs text-muted">{COPY.left}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {items && rows && items.length > rows.length ? (
        <div className="-mx-4 -mb-4 border-t border-line px-4 py-2.5 sm:-mx-5 sm:-mb-5 sm:px-5">
          <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
            {COPY.showAll(items.length)}
          </Button>
        </div>
      ) : all && more > 0 ? (
        <p className="-mx-4 -mb-4 border-t border-line px-4 py-2.5 text-sm text-muted sm:-mx-5 sm:-mb-5 sm:px-5">
          {COPY.more(more)} <RecordLink href={APP_ROUTES.payments}>{COPY.inPayments}</RecordLink>
        </p>
      ) : null}
    </Card>
  );
}
