"use client";

import { buttonClasses, Card, EmptyState, Money, Skeleton } from "@forwend/ui-web";
import { ChevronRight, Wallet } from "lucide-react";
import Link from "next/link";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import type { Balances } from "@/features/balances/types/balances";
import { findPrice, formatUsdCents, latestUsd, usdCents } from "@/features/prices/lib/prices";
import type { TokenPrice } from "@/features/prices/types/prices";
import { BUSINESS_COPY as COPY } from "@/screens/dashboard/constants/business-copy";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { LoadError } from "@/shared/components/load-error";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";

export interface AssetsCardProps {
  balances: Balances | null;
  failed: boolean;
  onRetry: () => void;
  prices: readonly TokenPrice[] | undefined;
}

// The share bar's steps, darkest first, so the largest holding reads first in both themes.
const SHARES = ["bg-ink", "bg-muted", "bg-subtle", "bg-line-strong"] as const;
// A profile can hold hundreds of tokens: the card shows the largest, My assets lists them all.
const SHOWN = 5;

/** A part of the whole in whole percent, "<1%" for a sliver, so small holdings never read as none. */
function share(part: bigint, whole: bigint): string {
  const percent = Number((part * 100n) / whole);
  return part > 0n && percent === 0 ? "<1%" : `${percent}%`;
}

/** What the wallet holds, token by token: the share bar shows the mix, each row its amount and market value. */
export function AssetsCard({ balances, failed, onRetry, prices }: AssetsCardProps) {
  const rows = (balances?.tokens ?? []).map((t) => {
    const usd = latestUsd(findPrice(prices ?? [], t.chainId, t.token));
    const cents = t.wallet !== null && usd ? usdCents(BigInt(t.wallet), t.decimals, usd) : null;
    return { t, cents };
  });
  const held = rows
    .filter((r) => r.t.wallet !== null && BigInt(r.t.wallet) > 0n)
    .sort((a, b) => Number((b.cents ?? 0n) - (a.cents ?? 0n)));
  const total = held.reduce((sum, r) => sum + (r.cents ?? 0n), 0n);
  // The bar's last step holds everything after the largest three.
  const parts = held.filter((r) => r.cents && r.cents > 0n).map((r) => r.cents ?? 0n);
  const bar = [
    ...parts.slice(0, SHARES.length - 1),
    parts.slice(SHARES.length - 1).reduce((a, b) => a + b, 0n),
  ];
  return (
    <Card
      id="assets-title"
      title={COPY.assets}
      action={
        <Link
          href={APP_ROUTES.balances}
          className={`${buttonClasses({ variant: "ghost", size: "sm" })} -mt-1.5 -mr-2`}
        >
          {COPY.viewAll}
          <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)]" />
        </Link>
      }
      className="flex flex-col"
    >
      {!balances && failed ? (
        <LoadError message={BALANCES_COPY.balancesFailed} onRetry={onRetry} />
      ) : !balances ? (
        <Skeleton className="h-28" />
      ) : rows.length === 0 ? (
        <EmptyState compact icon={Wallet} title={BALANCES_COPY.noTokens} />
      ) : held.length === 0 ? (
        <EmptyState compact icon={Wallet} title={COPY.nothingHeld} />
      ) : (
        <>
          {total > 0n ? (
            <div aria-hidden className="mb-3 flex h-2 gap-0.5 overflow-hidden rounded-sm">
              {bar
                .filter((cents) => cents > 0n)
                .map((cents, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: the steps are positions, largest first.
                    key={i}
                    className={SHARES[i]}
                    style={{ flexGrow: Number((cents * 1000n) / total) }}
                  />
                ))}
            </div>
          ) : null}
          <ul className="divide-y divide-line border-t border-line">
            {held.slice(0, SHOWN).map(({ t, cents }, i) => (
              <li
                key={`${t.chainId}:${t.token}`}
                className="flex items-center justify-between gap-4 py-2.5"
              >
                <span className="flex min-w-0 items-center gap-3">
                  {/* Its step in the bar above: the same shade, largest first. */}
                  <span
                    aria-hidden
                    className={`size-2 shrink-0 rounded-pill ${SHARES[Math.min(i, SHARES.length - 1)]}`}
                  />
                  <TokenMark chainId={t.chainId} symbol={t.symbol} />
                </span>
                <span className="flex flex-col items-end text-sm">
                  {t.wallet === null ? (
                    <span className="text-subtle">—</span>
                  ) : (
                    <Money
                      baseUnits={BigInt(t.wallet)}
                      decimals={t.decimals}
                      className="text-ink"
                    />
                  )}
                  {cents !== null ? (
                    <span className="text-xs text-muted tabular-nums">
                      {formatUsdCents(cents)} {MONEY_COPY.usd}
                      {total > 0n ? ` · ${share(cents, total)}` : null}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {held.length > SHOWN ? (
            <p className="border-t border-line pt-2.5 text-xs text-muted">
              {COPY.moreAssets(held.length - SHOWN)}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
