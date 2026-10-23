"use client";

import { Button, Skeleton } from "@forwend/ui-web";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { EstimateHint } from "@/features/balances/components/estimate-hint";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { formatUsd, usdTotal } from "@/features/balances/lib/balances";
import type { Balances } from "@/features/balances/types/balances";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";

export interface BalanceFigureProps {
  balances: Balances | null;
  failed: boolean;
  onRetry: () => void;
}

// Never a made-up 0 while loading or after a failed read. The parent is the size container.
export function BalanceFigure({ balances, failed, onRetry }: BalanceFigureProps) {
  const tokens = balances?.tokens ?? [];
  const total = balances ? usdTotal(balances, "wallet") : null;
  const text = total === null ? "—" : formatUsd(total);
  const figure =
    "text-[length:clamp(2rem,min(14cqi,160cqi_/_var(--chars)),5.25rem)] leading-none font-semibold tracking-[-0.03em] text-ink";
  const align = "items-center text-center lg:items-start lg:text-left";
  // px-7 leaves room for the hanging hint on both sides.
  const row = "flex flex-wrap items-baseline justify-center gap-x-2 px-7 lg:justify-start lg:px-0";

  if (!balances && failed) {
    return (
      <div role="alert" className={`flex flex-col gap-3 text-sm text-muted ${align}`}>
        {BALANCES_COPY.balancesFailed}
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {BALANCES_COPY.retry}
        </Button>
      </div>
    );
  }
  if (!balances)
    return <Skeleton className="mx-auto h-[clamp(2rem,14cqi,5.25rem)] w-56 max-w-full lg:mx-0" />;
  if (tokens.length === 0)
    return <p className={`flex ${align} text-muted`}>{BALANCES_COPY.noTokens}</p>;

  return (
    <div className={`flex w-full flex-col gap-2 ${align}`}>
      <p className={row}>
        <span className={figure} style={{ "--chars": text.length } as CSSProperties}>
          {text}
        </span>
        {/* The hint hangs after USD and takes no width, so the total itself sits on the center line. */}
        <span className="relative text-xl font-medium whitespace-nowrap text-muted">
          {MONEY_COPY.usd}
          <span className="absolute top-1/2 left-full ml-1 -translate-y-1/2">
            <EstimateHint />
          </span>
        </span>
      </p>
      {total === null ? <p className="text-sm text-muted">{BALANCES_COPY.unavailable}</p> : null}
      <PendingHeld balances={balances} />
    </div>
  );
}

function PendingHeld({ balances }: { balances: Balances }) {
  const summaries = [
    { field: "pending", label: BALANCES_COPY.pending },
    { field: "held", label: BALANCES_COPY.held },
  ] as const;
  return (
    <div className="flex max-w-full flex-wrap justify-center gap-x-3 gap-y-1 empty:hidden lg:justify-start">
      {summaries.map(({ field, label }) => {
        if (!balances.tokens.some((t) => BigInt(t[field]) > 0n)) return null;
        const total = usdTotal(balances, field);
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
