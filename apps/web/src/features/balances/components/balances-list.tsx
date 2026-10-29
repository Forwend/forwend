"use client";

import { Button, EmptyState, Money, SearchField, Skeleton } from "@forwend/ui-web";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { notFinal } from "@/features/balances/lib/balances";
import type { Balances, TokenBalance } from "@/features/balances/types/balances";
import { findPrice, formatUsdCents, freshUsd, usdCents } from "@/features/prices/lib/prices";
import type { TokenPrice } from "@/features/prices/types/prices";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { LoadError } from "@/shared/components/load-error";
import { NoMatch } from "@/shared/components/no-match";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { TOKEN_SEARCH_FROM, tokenMatches } from "@/shared/lib/chains";

export interface BalancesListProps {
  balances: Balances | null;
  /** Market prices (D-115): each in-wallet amount adds its USD value under it when one is fresh. */
  prices?: readonly TokenPrice[];
  failed: boolean;
  onRetry: () => void;
}

const isEmpty = (t: TokenBalance) =>
  [t.wallet, t.pending, t.held].every((v) => v === null || v === "0");

export function BalancesList({ balances, prices, failed, onRetry }: BalancesListProps) {
  const [query, setQuery] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  if (!balances && failed)
    return <LoadError message={BALANCES_COPY.balancesFailed} onRetry={onRetry} />;
  if (!balances) return <Skeleton className="h-40" />;
  if (balances.tokens.length === 0)
    return <EmptyState icon={Wallet} title={BALANCES_COPY.noTokens} />;
  const columns = "md:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,1fr))]";
  const found = balances.tokens.filter((t) => tokenMatches(t, query));
  // Tokens on but never used would bury what is held; a search still finds them.
  const shown = query || showEmpty ? found : found.filter((t) => !isEmpty(t));
  const hidden = found.length - shown.length;
  return (
    <div className="flex flex-col gap-3">
      {balances.tokens.length > TOKEN_SEARCH_FROM ? (
        <SearchField
          label={BALANCES_COPY.searchTokens}
          placeholder={BALANCES_COPY.searchTokensPlaceholder}
          value={query}
          onValueChange={setQuery}
          className="sm:max-w-sm"
        />
      ) : null}
      <div className="fw-panel overflow-hidden">
        {/* Each amount keeps its own label for screen readers; this row only shows them once on wide screens. */}
        <div
          aria-hidden
          className={`hidden h-10 items-center gap-4 border-b border-line px-5 text-right text-xs font-medium text-muted md:grid ${columns}`}
        >
          <span className="text-left">{BALANCES_COPY.asset}</span>
          <span>{BALANCES_COPY.inWallet}</span>
          <span title={BALANCES_COPY.movingHint}>{BALANCES_COPY.movingLabel}</span>
          <span title={BALANCES_COPY.notFinalHint}>{BALANCES_COPY.notFinalLabel}</span>
          <span title={BALANCES_COPY.heldHint}>{BALANCES_COPY.heldLabel}</span>
        </div>
        <ul className="divide-y divide-line">
          {shown.map((t) => (
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
              <Amount label={BALANCES_COPY.movingLabel} t={t} value={t.settling ?? t.pending} />
              <Amount label={BALANCES_COPY.notFinalLabel} t={t} value={notFinal(t)} />
              <Amount label={BALANCES_COPY.heldLabel} t={t} value={t.held} />
            </li>
          ))}
        </ul>
        {shown.length > 0 ? null : query ? (
          <NoMatch compact onClear={() => setQuery("")} clearLabel={BALANCES_COPY.clearSearch} />
        ) : (
          <EmptyState compact icon={Wallet} title={BALANCES_COPY.nothingHeld} />
        )}
        {hidden > 0 ? (
          <div className="border-t border-line px-4 py-2.5 sm:px-5">
            <Button size="sm" variant="ghost" onClick={() => setShowEmpty(true)}>
              {BALANCES_COPY.showEmpty(hidden)}
            </Button>
          </div>
        ) : null}
      </div>
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
  // Nothing on its way or held is the usual case: a quiet dash on wide screens, no row at all on phones.
  if (!strong && value === "0") {
    return (
      <span className="hidden text-right text-subtle md:block">
        <span className="sr-only">{label}: </span>—
      </span>
    );
  }
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
