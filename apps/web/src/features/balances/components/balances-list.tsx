"use client";

import { Button, EmptyState, Money, SearchField, Skeleton } from "@forwend/ui-web";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { notFinal } from "@/features/balances/lib/balances";
import type { Balances, TokenBalance } from "@/features/balances/types/balances";
import { findPrice, formatUsdCents, latestUsd, usdCents } from "@/features/prices/lib/prices";
import type { TokenPrice } from "@/features/prices/types/prices";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { LoadError } from "@/shared/components/load-error";
import { NoMatch } from "@/shared/components/no-match";
import { LineSkeleton } from "@/shared/components/rows-skeleton";
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

const COLUMNS = "md:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,1fr))]";
// Phones: the token on the left, what is in the wallet on the right. Wide screens: a column per kind of money.
const ROW = `grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 text-sm sm:px-5 md:min-h-16 md:gap-4 ${COLUMNS}`;
const AMOUNT = "text-ink md:text-base";

export function BalancesList({ balances, prices, failed, onRetry }: BalancesListProps) {
  const [query, setQuery] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  if (!balances && failed)
    return <LoadError message={BALANCES_COPY.balancesFailed} onRetry={onRetry} />;
  if (!balances)
    return (
      <div aria-hidden className="fw-panel overflow-hidden">
        <ColumnTitles />
        <ul className="divide-y divide-line">
          {[0, 1].map((i) => (
            <li key={i} className={ROW}>
              <span className="flex items-center gap-3">
                <Skeleton className="size-9 shrink-0 rounded-pill" />
                <span>
                  <LineSkeleton className="w-12" />
                  <LineSkeleton size="text-xs" className="w-20" />
                </span>
              </span>
              <span className="flex flex-col items-end">
                <LineSkeleton size={AMOUNT} className="w-28" />
                <LineSkeleton size="text-xs" className="w-20" />
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  if (balances.tokens.length === 0)
    return <EmptyState icon={Wallet} title={BALANCES_COPY.noTokens} />;
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
        <ColumnTitles />
        <ul className="divide-y divide-line">
          {shown.map((t) => {
            const parts = [
              { label: BALANCES_COPY.movingLabel, value: t.settling ?? t.pending },
              { label: BALANCES_COPY.notFinalLabel, value: notFinal(t) },
              { label: BALANCES_COPY.heldLabel, value: t.held },
            ];
            const usd = latestUsd(findPrice(prices ?? [], t.chainId, t.token));
            return (
              <li key={`${t.chainId}:${t.token}`} className={ROW}>
                <TokenMark chainId={t.chainId} symbol={t.symbol} />
                <div className="flex flex-col items-end text-right">
                  <span className="sr-only">{BALANCES_COPY.inWallet}: </span>
                  {t.wallet === null ? (
                    <span className="max-w-44 text-xs text-subtle md:max-w-none">
                      {BALANCES_COPY.unavailable}
                    </span>
                  ) : (
                    <>
                      <Money
                        baseUnits={BigInt(t.wallet)}
                        decimals={t.decimals}
                        token={t.symbol}
                        className={AMOUNT}
                      />
                      {usd ? (
                        <span className="text-xs text-muted tabular-nums">
                          {formatUsdCents(usdCents(BigInt(t.wallet), t.decimals, usd))}{" "}
                          {MONEY_COPY.usd}
                        </span>
                      ) : null}
                    </>
                  )}
                </div>
                {/* Phones show money on its way or on hold in one box under the token, and nothing when there is
                    none; wide screens give each kind its column. */}
                <div
                  className={`${parts.some((p) => p.value !== "0") ? "col-span-2 ml-12 flex flex-col gap-1 rounded-md bg-surface-2 px-3 py-2" : "hidden"} md:contents`}
                >
                  {parts.map((p) => (
                    <Part key={p.label} label={p.label} value={p.value} decimals={t.decimals} />
                  ))}
                </div>
              </li>
            );
          })}
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

/** Wide screens name each column once; each amount keeps its own label for screen readers. */
function ColumnTitles() {
  return (
    <div
      aria-hidden
      className={`hidden h-10 items-center gap-4 border-b border-line px-5 text-right text-xs font-medium text-muted md:grid ${COLUMNS}`}
    >
      <span className="text-left">{BALANCES_COPY.asset}</span>
      <span>{BALANCES_COPY.inWallet}</span>
      <span title={BALANCES_COPY.movingHint}>{BALANCES_COPY.movingLabel}</span>
      <span title={BALANCES_COPY.notFinalHint}>{BALANCES_COPY.notFinalLabel}</span>
      <span title={BALANCES_COPY.heldHint}>{BALANCES_COPY.heldLabel}</span>
    </div>
  );
}

function Part({ label, value, decimals }: { label: string; value: string; decimals: number }) {
  // Nothing on its way or held is the usual case: a quiet dash on wide screens, no line at all on phones.
  if (value === "0") {
    return (
      <span className="hidden text-right text-subtle md:block">
        <span className="sr-only">{label}: </span>—
      </span>
    );
  }
  return (
    <div className="flex items-baseline justify-between gap-4 text-xs md:justify-end md:text-sm">
      <span className="text-muted md:sr-only">{label}</span>
      <Money baseUnits={BigInt(value)} decimals={decimals} className="text-ink md:text-muted" />
    </div>
  );
}
