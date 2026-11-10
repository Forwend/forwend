"use client";

import { formatTokenAmount, ROW_INTERACTIVE_CLASSES } from "@forwend/ui-web";
import { ChevronDown, ChevronRight, CircleDashed, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { formatUsd } from "@/features/balances/lib/balances";
import { useGetOwedQuery } from "@/features/invoices/api/invoices-api";
import { OWED_KINDS } from "@/features/invoices/constants/invoices";
import { INVOICES_COPY, OWED_COPY } from "@/features/invoices/constants/invoices-copy";
import { formatDueDateShort, invoiceNumber, owedCents } from "@/features/invoices/lib/invoices";
import type { Owed } from "@/features/invoices/types/invoices";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { ENTER } from "@/shared/constants/motion";
import { exactDigits } from "@/shared/lib/money";

const COPY = INVOICES_COPY.attention;
// Beside the total from medium panels up; a phone lists every one under the strip when it is opened.
const SHOWN = 2;

/** R-253: the late and partly paid invoices, with what is left to pay, before the list. It reads the answer the
 * Overview's Unpaid panel loads; a checkout session has no invoice, so it stays out. Nothing shows while it loads
 * or when nothing needs attention. */
export function InvoicesAttention({ profileId }: { profileId: string }) {
  const owed = useGetOwedQuery(profileId, LIVE_QUERY);
  // ponytail: counted from the first rows the API returns, most urgent first; a profile with more late invoices
  // than that page shows a lower total here. Ask the API for a count per kind if that matters.
  const items = (owed.currentData?.items ?? []).filter(
    (o) => o.number !== null && (o.kind === OWED_KINDS.overdue || o.kind === OWED_KINDS.partlyPaid),
  );
  if (items.length === 0) return null;
  const total = `${formatUsd(owedCents(items))} ${MONEY_COPY.usd}`;
  const overdue = items.filter((o) => o.kind === OWED_KINDS.overdue).length;
  return (
    <section aria-label={COPY.title} className={`@container ${ENTER}`}>
      <div className="fw-panel hidden divide-x divide-line overflow-hidden @3xl:flex">
        <div className="flex w-56 shrink-0 flex-col justify-center gap-0.5 px-5 py-4">
          <p className="text-xs text-muted">{COPY.title}</p>
          <p className="text-xl font-semibold text-ink tabular-nums">{total}</p>
          <p className="text-xs text-muted">{COPY.leftIn(items.length)}</p>
        </div>
        {items.slice(0, SHOWN).map((o) => (
          <Row key={`${o.invoiceId}-${o.kind}`} owed={o} className="min-w-0 flex-1" />
        ))}
      </div>
      {/* Narrow panels: one strip that opens to the invoices it counts. */}
      <details className="group overflow-hidden rounded-lg bg-warning-soft @3xl:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
          <TriangleAlert aria-hidden className="size-[var(--fw-icon-md)] shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">{COPY.count(items.length)}</span>
            <span className="block text-xs text-muted">
              {[COPY.leftToPay(total), COPY.kinds(overdue, items.length - overdue)].join(" · ")}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className="size-[var(--fw-icon-sm)] shrink-0 text-muted transition-transform duration-[var(--fw-duration-fast)] group-open:rotate-180"
          />
        </summary>
        <ul className="divide-y divide-line border-t border-line bg-surface">
          {items.map((o) => (
            <li key={`${o.invoiceId}-${o.kind}`}>
              <Row owed={o} />
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function Row({ owed: o, className = "" }: { owed: Owed; className?: string }) {
  const units = BigInt(o.amount);
  const late = o.kind === OWED_KINDS.overdue;
  const Icon = late ? TriangleAlert : CircleDashed;
  const number = invoiceNumber(o.number);
  return (
    <Link
      href={`${APP_ROUTES.invoices}/${o.invoiceId}`}
      className={`flex items-center gap-3 px-4 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${ROW_INTERACTIVE_CLASSES} ${className}`}
    >
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-pill bg-warning-soft text-warning"
      >
        <Icon className="size-[var(--fw-icon-sm)]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">
          <span className="font-medium text-ink">{number}</span>
          {o.clientName ? <span className="text-muted"> {o.clientName}</span> : null}
        </span>
        <span className="block truncate text-xs text-muted">
          <span className="font-medium text-warning">
            {late ? COPY.overdue(OWED_COPY.kinds.overdue(o.daysLate)) : COPY.partlyPaid}
          </span>
          {o.dueDate ? ` · ${COPY.dueDate(formatDueDateShort(o.dueDate, new Date()))}` : null}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="text-sm font-medium whitespace-nowrap text-ink tabular-nums">
          {formatTokenAmount({
            baseUnits: units,
            decimals: o.decimals,
            fractionDigits: exactDigits(units, o.decimals),
          })}{" "}
          <span className="text-xs font-normal text-muted">
            {o.optionCount > 1 ? MONEY_COPY.usd : o.symbol}
          </span>
        </span>
        <span className="text-xs text-muted">{COPY.left}</span>
      </span>
      <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)] shrink-0 text-muted" />
    </Link>
  );
}
