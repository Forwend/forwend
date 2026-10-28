"use client";

import { Button, Money, Skeleton } from "@forwend/ui-web";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import type { Balances, TokenBalance } from "@/features/balances/types/balances";
import { findPrice, formatUsdCents, freshUsd, usdCents } from "@/features/prices/lib/prices";
import type { TokenPrice } from "@/features/prices/types/prices";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { MONEY_COPY } from "@/shared/constants/money-copy";

export interface BalancesListProps {
  balances: Balances | null;
  /** Market prices (D-115): each in-wallet amount adds its USD value under it when one is fresh. */
  prices?: readonly TokenPrice[];
  failed: boolean;
  onRetry: () => void;
}

export function BalancesList({ balances, prices, failed, onRetry }: BalancesListProps) {
  if (!balances && failed) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-4 text-muted">
        {BALANCES_COPY.balancesFailed}
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {BALANCES_COPY.retry}
        </Button>
      </div>
    );
  }
  if (!balances) return <Skeleton className="h-40" />;
  if (balances.tokens.length === 0) return <p className="text-muted">{BALANCES_COPY.noTokens}</p>;
  const columns = "md:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))]";
  return (
    <div className="fw-panel overflow-hidden">
      {/* Each amount keeps its own label for screen readers; this row only shows them once on wide screens. */}
      <div
        aria-hidden
        className={`hidden h-10 items-center gap-4 border-b border-line px-5 text-right text-xs font-medium text-muted md:grid ${columns}`}
      >
        <span />
        <span>{BALANCES_COPY.inWallet}</span>
        <span>{BALANCES_COPY.pendingLabel}</span>
        <span>{BALANCES_COPY.heldLabel}</span>
      </div>
      <ul className="divide-y divide-line">
        {balances.tokens.map((t) => (
          <li
            key={`${t.chainId}:${t.token}`}
            className={`grid gap-3 px-4 py-4 sm:px-5 md:min-h-16 md:items-center md:gap-4 md:py-3 ${columns}`}
          >
            <TokenMark chainId={t.chainId} symbol={t.symbol} />
            <Amount
              label={BALANCES_COPY.inWallet}
              t={t}
              value={t.wallet}
              usd={freshUsd(findPrice(prices ?? [], t.chainId, t.token), Date.now())}
              strong
            />
            <Amount label={BALANCES_COPY.pendingLabel} t={t} value={t.pending} />
            <Amount label={BALANCES_COPY.heldLabel} t={t} value={t.held} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Amount({
  label,
  t,
  value,
  usd,
  strong,
}: {
  label: string;
  t: TokenBalance;
  value: string | null;
  usd?: string | null;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 md:justify-end">
      <span className="text-sm text-muted md:sr-only">{label}</span>
      {value === null ? (
        <span className="text-sm text-subtle">{BALANCES_COPY.unavailable}</span>
      ) : (
        <span className="flex flex-col items-end">
          <Money
            baseUnits={BigInt(value)}
            decimals={t.decimals}
            className={strong ? "text-lg text-ink" : "text-muted"}
          />
          {usd ? (
            <span className="text-xs text-muted tabular-nums">
              {formatUsdCents(usdCents(BigInt(value), t.decimals, usd))} {MONEY_COPY.usd}
            </span>
          ) : null}
        </span>
      )}
    </div>
  );
}
