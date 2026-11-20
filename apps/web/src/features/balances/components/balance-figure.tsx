"use client";

import { BigAmount, Skeleton } from "@forwend/ui-web";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { EstimateHint } from "@/features/balances/components/estimate-hint";
import { BALANCE_FIELDS } from "@/features/balances/constants/balances";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { fieldUnits, marketUsd } from "@/features/balances/lib/balances";
import type { Balances } from "@/features/balances/types/balances";
import type { TokenPrice } from "@/features/prices/types/prices";
import { LoadError } from "@/shared/components/load-error";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { formatUsd } from "@/shared/lib/money";

export interface BalanceFigureProps {
  balances: Balances | null;
  prices: readonly TokenPrice[] | undefined;
  failed: boolean;
  onRetry: () => void;
  change?: ReactNode;
  pending?: boolean;
}

// Never a made-up 0 while loading or after a failed read.
export function BalanceFigure({
  balances,
  prices,
  failed,
  onRetry,
  change,
  pending = true,
}: BalanceFigureProps) {
  const tokens = balances?.tokens ?? [];
  const total = balances ? marketUsd(balances, BALANCE_FIELDS.wallet, prices) : null;
  const text = total === null ? "—" : formatUsd(total);
  const align = "items-center text-center sm:items-start sm:text-left";

  if (!balances && failed) {
    return <LoadError message={BALANCES_COPY.balancesFailed} onRetry={onRetry} />;
  }
  if (!balances)
    return (
      <div className={`flex w-full flex-col gap-2 ${align}`}>
        <Skeleton className="h-[clamp(2.5rem,13cqi,4rem)] w-56 max-w-full" />
        {change}
      </div>
    );
  if (tokens.length === 0)
    return <p className={`flex ${align} text-muted`}>{BALANCES_COPY.noTokens}</p>;

  return (
    <div className={`flex w-full flex-col gap-2 ${align}`}>
      <p
        className="max-w-full px-7 sm:px-0"
        style={{ "--chars": text.length + MONEY_COPY.usd.length / 3 } as CSSProperties}
      >
        <span className="relative inline-block">
          <BigAmount
            value={text}
            unit={MONEY_COPY.usd}
            className="text-[length:clamp(2.5rem,min(13cqi,150cqi_/_var(--chars)),4rem)] leading-none"
          />
          <span className="absolute bottom-0 left-full ml-1">
            <EstimateHint />
          </span>
        </span>
      </p>
      {change}
      {total === null ? (
        <p className="text-sm text-muted">
          {tokens.some((t) => t.wallet === null)
            ? BALANCES_COPY.unavailable
            : BALANCES_COPY.noPrices}
        </p>
      ) : null}
      {pending ? <PendingHeld balances={balances} prices={prices} /> : null}
    </div>
  );
}

function PendingHeld({
  balances,
  prices,
}: {
  balances: Balances;
  prices: readonly TokenPrice[] | undefined;
}) {
  const summaries = [
    { field: BALANCE_FIELDS.settling, label: BALANCES_COPY.moving },
    { field: BALANCE_FIELDS.notFinal, label: BALANCES_COPY.notFinal },
    { field: BALANCE_FIELDS.held, label: BALANCES_COPY.held },
  ];
  return (
    <div className="flex max-w-full flex-wrap justify-center gap-x-3 gap-y-1 empty:hidden lg:justify-start">
      {summaries.map(({ field, label }) => {
        if (!balances.tokens.some((t) => BigInt(fieldUnits(t, field) ?? "0") > 0n)) return null;
        const total = marketUsd(balances, field, prices);
        if (total === null) return null;
        return (
          <Link
            key={field}
            href={APP_ROUTES.balances}
            className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm text-muted underline decoration-line underline-offset-4 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span>
              <span className="font-medium tabular-nums text-ink">
                {total === 0n ? BALANCES_COPY.lessThanCent : formatUsd(total)} {MONEY_COPY.usd}
              </span>{" "}
              {label}
            </span>
            <ChevronRight aria-hidden className="size-3.5 shrink-0" />
          </Link>
        );
      })}
    </div>
  );
}
