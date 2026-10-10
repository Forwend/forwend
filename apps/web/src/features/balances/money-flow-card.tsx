"use client";

import { Skeleton } from "@forwend/ui-web";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { HISTORY_FIELDS, historySeries, seriesTotal } from "@/features/balances/balance-history";
import { formatUsd, USD } from "@/features/balances/balances";
import { useGetBalanceHistoryQuery } from "@/features/balances/balances-api";
import { BALANCES_COPY } from "@/features/balances/balances-copy";
import { LIVE_QUERY } from "@/shared/config/refresh";

const DAYS = 30;

export function MoneyFlowCard({ profileId }: { profileId: string }) {
  const history = useGetBalanceHistoryQuery({ profileId, days: DAYS }, LIVE_QUERY);
  const flows = history.data
    ? ([
        [
          BALANCES_COPY.moneyIn,
          historySeries(history.data, HISTORY_FIELDS.received),
          ArrowDownLeft,
        ],
        [BALANCES_COPY.moneyOut, historySeries(history.data, HISTORY_FIELDS.sent), ArrowUpRight],
      ] as const)
    : null;
  return (
    <section
      aria-labelledby="flow-title"
      className="flex flex-col rounded-md border border-line bg-surface"
    >
      <div className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3 sm:px-5">
        <h2 id="flow-title" className="text-base font-semibold text-ink">
          {BALANCES_COPY.moneyFlow}
        </h2>
        <span className="text-xs text-muted">{BALANCES_COPY.pastMonth}</span>
      </div>
      {!flows ? (
        history.isError ? (
          <p role="alert" className="px-5 py-6 text-sm text-muted">
            {BALANCES_COPY.historyFailed}
          </p>
        ) : (
          <Skeleton className="m-5 h-16" />
        )
      ) : (
        <dl className="grid grid-cols-2 divide-x divide-line">
          {flows.map(([label, series, Icon]) => (
            <div key={label} className="flex flex-col gap-1 px-4 py-4 sm:px-5">
              <dt className="flex items-center gap-1.5 text-sm text-muted">
                <Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
                {label}
              </dt>
              <dd className="font-mono text-base text-ink tabular-nums">
                {series ? `${formatUsd(seriesTotal(series))} ${USD}` : "—"}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
