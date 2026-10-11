"use client";

import { Button, Money, Skeleton } from "@forwend/ui-web";
import type { Balances, TokenBalance } from "@/features/balances/balances";
import { BALANCES_COPY } from "@/features/balances/balances-copy";
import { TokenMark } from "@/shared/chains/token-mark";

// Every enabled token on every network: what the wallet holds there (read at the network's finalized block), and
// apart from it what is on its way and what is held for payers.
export function BalancesList({
  balances,
  failed,
  onRetry,
}: {
  balances: Balances | null;
  failed: boolean;
  onRetry: () => void;
}) {
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
  return (
    <ul className="flex flex-col gap-4">
      {balances.tokens.map((t) => (
        <li
          key={`${t.chainId}:${t.token}`}
          className="grid gap-4 rounded-md border border-line bg-surface p-5 sm:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))] sm:items-center"
        >
          <TokenMark chainId={t.chainId} symbol={t.symbol} />
          <Amount label={BALANCES_COPY.inWallet} t={t} value={t.wallet} strong />
          <Amount label={BALANCES_COPY.pendingLabel} t={t} value={t.pending} />
          <Amount label={BALANCES_COPY.heldLabel} t={t} value={t.held} />
        </li>
      ))}
    </ul>
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
    <div className="flex items-baseline justify-between gap-4 sm:flex-col sm:items-end sm:gap-1">
      <span className="text-sm text-muted">{label}</span>
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
