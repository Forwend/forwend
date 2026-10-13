"use client";

import { Button, Money, Skeleton } from "@forwend/ui-web";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import type { Balances, TokenBalance } from "@/features/balances/types/balances";
import { TokenMark } from "@/shared/components/chains/token-mark";

export interface BalancesListProps {
  balances: Balances | null;
  failed: boolean;
  onRetry: () => void;
}

// Every enabled token on every network: what the wallet holds there (read at the network's finalized block), and
// apart from it what is on its way and what is held for payers.
export function BalancesList({ balances, failed, onRetry }: BalancesListProps) {
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
    <div className="rounded-md border border-line bg-surface">
      {/* Each amount keeps its own label for screen readers; this row only shows them once on wide screens. */}
      <div
        aria-hidden
        className={`hidden gap-4 border-b border-line px-5 py-2.5 text-right text-xs text-muted md:grid ${columns}`}
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
            className={`grid gap-4 p-5 md:items-center md:py-4 ${columns}`}
          >
            <TokenMark chainId={t.chainId} symbol={t.symbol} />
            <Amount label={BALANCES_COPY.inWallet} t={t} value={t.wallet} strong />
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
  strong,
}: {
  label: string;
  t: TokenBalance;
  value: string | null;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 md:justify-end">
      <span className="text-sm text-muted md:sr-only">{label}</span>
      {value === null ? (
        <span className="text-sm text-subtle">{BALANCES_COPY.unavailable}</span>
      ) : (
        <Money
          baseUnits={BigInt(value)}
          decimals={t.decimals}
          className={strong ? "text-lg text-ink" : "text-muted"}
        />
      )}
    </div>
  );
}
