import { Money, Skeleton } from "@forwend/ui-web";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import type { Balances } from "@/features/balances/types/balances";
import { TokenMark } from "@/shared/components/chains/token-mark";
import { APP_ROUTES } from "@/shared/config/routes";

export interface NetworksCardProps {
  balances: Balances | null;
  failed: boolean;
}

// Every token at 18 decimals, so shares compare tokens with different decimals.
const SHARE_DECIMALS = 18;
const scaled = (units: string | null, decimals: number) =>
  units === null ? 0n : BigInt(units) * 10n ** BigInt(Math.max(SHARE_DECIMALS - decimals, 0));

// Where the money is: each enabled token on each network, with what the wallet holds there and its share of the
// whole, each stablecoin counted as 1 USD.
export function NetworksCard({ balances, failed }: NetworksCardProps) {
  const total = (balances?.tokens ?? []).reduce((sum, t) => sum + scaled(t.wallet, t.decimals), 0n);
  const share = (units: string | null, decimals: number) =>
    total === 0n ? 0 : Number((scaled(units, decimals) * 1000n) / total) / 10;
  return (
    <section
      aria-labelledby="networks-title"
      className="flex flex-col rounded-md border border-line bg-surface"
    >
      <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 sm:px-5">
        <h2 id="networks-title" className="text-base font-semibold text-ink">
          {BALANCES_COPY.byNetwork}
        </h2>
        <Link
          href={APP_ROUTES.balances}
          className="inline-flex h-9 items-center gap-1 rounded-sm px-2 text-sm text-muted hover:bg-surface-2 hover:text-ink"
        >
          {BALANCES_COPY.viewAll}
          <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)]" />
        </Link>
      </div>
      {!balances && failed ? (
        // Not an alert: the page's balance already announces the same failure.
        <p className="px-5 py-6 text-sm text-muted">{BALANCES_COPY.balancesFailed}</p>
      ) : !balances ? (
        <Skeleton className="m-5 h-16" />
      ) : balances.tokens.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">{BALANCES_COPY.noTokens}</p>
      ) : (
        <ul className="divide-y divide-line">
          {balances.tokens.map((t) => (
            <li key={`${t.chainId}:${t.token}`} className="flex flex-col gap-2.5 px-4 py-3 sm:px-5">
              <div className="flex items-center justify-between gap-4">
                <TokenMark chainId={t.chainId} symbol={t.symbol} />
                {t.wallet === null ? (
                  <span className="text-sm text-subtle">—</span>
                ) : (
                  <Money baseUnits={BigInt(t.wallet)} decimals={t.decimals} className="text-ink" />
                )}
              </div>
              {total === 0n || t.wallet === null ? null : (
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-2"
                  >
                    <span
                      className="block h-full rounded-pill bg-primary"
                      style={{ width: `${share(t.wallet, t.decimals)}%` }}
                    />
                  </span>
                  <span className="w-12 text-right text-xs text-muted tabular-nums">
                    {BALANCES_COPY.share(share(t.wallet, t.decimals))}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
