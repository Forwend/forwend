"use client";

import { Button, Skeleton } from "@forwend/ui-web";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useGetBalanceHistoryQuery } from "@/features/balances/api/balances-api";
import { HISTORY_FIELDS } from "@/features/balances/constants/balance-history";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { historySeries, seriesTotal } from "@/features/balances/lib/balance-history";
import { formatUsd } from "@/features/balances/lib/balances";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { MONEY_COPY } from "@/shared/constants/money-copy";

const DAYS = 30;

export interface MoneyFlowCardProps {
  profileId: string;
}

export function MoneyFlowCard({ profileId }: MoneyFlowCardProps) {
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
    <section aria-labelledby="flow-title" className="fw-panel flex flex-col">
      <div className="fw-panel-head justify-between">
        <h2 id="flow-title" className="text-base font-semibold text-ink">
          {BALANCES_COPY.moneyFlow}
        </h2>
        <span className="text-xs text-muted">{BALANCES_COPY.pastMonth}</span>
      </div>
      {!flows ? (
        history.isError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 px-5 py-6 text-sm text-muted"
          >
            {BALANCES_COPY.historyFailed}
            <Button size="sm" variant="secondary" onClick={history.refetch}>
              {BALANCES_COPY.retry}
            </Button>
          </div>
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
              <dd className="text-base font-medium text-ink tabular-nums">
                {series ? `${formatUsd(seriesTotal(series))} ${MONEY_COPY.usd}` : "—"}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
