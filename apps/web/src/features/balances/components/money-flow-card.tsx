"use client";

import { Card, Skeleton } from "@forwend/ui-web";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useGetBalanceHistoryQuery } from "@/features/balances/api/balances-api";
import { HISTORY_FIELDS } from "@/features/balances/constants/balance-history";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { historySeries, seriesTotal } from "@/features/balances/lib/balance-history";
import { formatUsd } from "@/features/balances/lib/balances";
import { LoadError } from "@/shared/components/load-error";
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
    <Card
      id="flow-title"
      title={BALANCES_COPY.moneyFlow}
      description={BALANCES_COPY.pastMonth}
      className="flex flex-col"
    >
      {!flows ? (
        history.isError ? (
          <LoadError message={BALANCES_COPY.historyFailed} onRetry={() => void history.refetch()} />
        ) : (
          <Skeleton className="h-14" />
        )
      ) : (
        // Beside the balance chart the two figures stack and share its height.
        <dl className="grid flex-1 grid-cols-2 divide-x divide-line xl:grid-cols-1 xl:grid-rows-2 xl:divide-x-0 xl:divide-y">
          {flows.map(([label, series, Icon]) => (
            <div
              key={label}
              className="flex flex-col gap-1 pr-4 last:pl-4 xl:justify-center xl:py-4 xl:pr-0 xl:last:pl-0"
            >
              <dt className="flex items-center gap-1.5 text-sm text-muted">
                <Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
                {label}
              </dt>
              <dd className="text-lg font-medium tracking-tight text-ink tabular-nums">
                {series ? `${formatUsd(seriesTotal(series))} ${MONEY_COPY.usd}` : "—"}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
