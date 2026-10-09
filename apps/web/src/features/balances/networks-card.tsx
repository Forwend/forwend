import { Money, Skeleton } from "@forwend/ui-web";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Balances } from "@/features/balances/balances";
import { BALANCES_COPY } from "@/features/balances/balances-copy";
import { TokenMark } from "@/shared/chains/token-mark";
import { APP_ROUTES } from "@/shared/config/routes";

// Where the money is: each enabled token on each network, with what the wallet holds there.
export function NetworksCard({ balances }: { balances: Balances | null }) {
  return (
    <section
      aria-labelledby="networks-title"
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="networks-title" className="text-sm text-muted">
          {BALANCES_COPY.networks}
        </h2>
        <Link
          href={APP_ROUTES.balances}
          className="inline-flex h-11 items-center gap-1 rounded-pill px-3 text-sm text-ink hover:bg-surface-2"
        >
          {BALANCES_COPY.allBalances}
          <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)]" />
        </Link>
      </div>
      {!balances ? (
        <Skeleton className="h-16" />
      ) : balances.tokens.length === 0 ? (
        <p className="text-sm text-muted">{BALANCES_COPY.noTokens}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {balances.tokens.map((t) => (
            <li key={`${t.chainId}:${t.token}`} className="flex items-center justify-between gap-4">
              <TokenMark chainId={t.chainId} symbol={t.symbol} />
              {t.wallet === null ? (
                <span className="text-sm text-subtle">—</span>
              ) : (
                <Money baseUnits={BigInt(t.wallet)} decimals={t.decimals} className="text-ink" />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
