"use client";

import { Button, formatTokenAmount, ROW_INTERACTIVE_CLASSES } from "@forwend/ui-web";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatUsd } from "@/features/balances/lib/balances";
import { useGetOwedQuery } from "@/features/invoices/api/invoices-api";
import { OWED_KINDS } from "@/features/invoices/constants/invoices";
import { OWED_COPY as COPY } from "@/features/invoices/constants/invoices-copy";
import { invoiceNumber, owedCents } from "@/features/invoices/lib/invoices";
import type { OwedKind } from "@/features/invoices/types/invoices";
import { RowsSkeleton } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { exactDigits } from "@/shared/lib/money";

const SHOWN = 5;

// R-95. Held money is the payer's, so it is not in the total.
export function OwedToYou({ profileId }: { profileId: string }) {
  const owed = useGetOwedQuery(profileId, LIVE_QUERY);
  const [all, setAll] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  // Show all goes away once pressed: focus moves to the first row it showed.
  useEffect(() => {
    if (all) list.current?.querySelectorAll("a")[SHOWN]?.focus();
  }, [all]);
  // A row kind a newer API adds is left out until this page knows its words.
  const items = owed.currentData?.filter((o) => Object.hasOwn(COPY.kinds, o.kind));
  const total = items ? owedCents(items) : 0n;
  const rows = items && !all ? items.slice(0, SHOWN) : items;

  return (
    <section
      aria-labelledby="owed-title"
      aria-busy={!items && !owed.isError}
      className="fw-panel flex flex-col"
    >
      <div className="fw-panel-head justify-between gap-3">
        <h2 id="owed-title" className="text-base font-semibold text-ink">
          {COPY.title}
        </h2>
        {total > 0n ? (
          <p className="text-sm font-semibold whitespace-nowrap text-ink tabular-nums">
            <span className="sr-only">{COPY.totalLabel}: </span>
            {formatUsd(total)} <span className="font-medium text-muted">{MONEY_COPY.usd}</span>
          </p>
        ) : null}
      </div>
      {owed.isError && !items ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 px-4 py-4 text-sm text-muted sm:px-5"
        >
          {COPY.failed}
          <Button size="sm" variant="secondary" onClick={owed.refetch}>
            {COPY.retry}
          </Button>
        </div>
      ) : !rows ? (
        <RowsSkeleton count={3} />
      ) : rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted sm:px-5">{COPY.none}</p>
      ) : (
        <ul ref={list} className="divide-y divide-line">
          {rows.map((o) => {
            const held = o.kind === OWED_KINDS.held;
            const name = o.clientName ?? o.title;
            const units = BigInt(o.amount);
            return (
              <li key={`${o.kind}-${o.invoiceId}-${o.chainId}-${o.token}`}>
                <Link
                  href={`${APP_ROUTES.invoices}/${o.invoiceId}`}
                  className={`flex min-h-16 items-center gap-3 px-4 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:px-5 ${ROW_INTERACTIVE_CLASSES}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">
                      {name ?? invoiceNumber(o.number)}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {name ? `${invoiceNumber(o.number)} · ` : null}
                      <span className={o.kind === OWED_KINDS.overdue ? "text-warning" : undefined}>
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
                        {!held && o.optionCount > 1 ? MONEY_COPY.usd : o.symbol}
                      </span>
                    </span>
                    {held ? null : <span className="text-xs text-muted">{COPY.left}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {items && rows && items.length > rows.length ? (
        <div className="border-t border-line px-4 py-3 sm:px-5">
          <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
            {COPY.showAll(items.length)}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
