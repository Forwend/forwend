import { buttonClasses, Money, Skeleton } from "@forwend/ui-web";
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

// Where the money is: each enabled token on each network, with what the wallet holds there.
export function NetworksCard({ balances, failed }: NetworksCardProps) {
  return (
    <section aria-labelledby="networks-title" className="fw-panel flex flex-col">
      <div className="fw-panel-head justify-between">
        <h2 id="networks-title" className="text-base font-semibold text-ink">
          {BALANCES_COPY.byNetwork}
        </h2>
        <Link
          href={APP_ROUTES.balances}
          className={`${buttonClasses({ variant: "ghost", size: "sm" })} -mr-2`}
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
            <li
              key={`${t.chainId}:${t.token}`}
              className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5"
            >
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
