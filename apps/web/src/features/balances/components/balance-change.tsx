import { TrendingDown, TrendingUp } from "lucide-react";
import { DEFAULT_RANGE } from "@/features/balances/constants/balance-history";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { seriesChange } from "@/features/balances/lib/balance-history";
import type { HistorySeries } from "@/features/balances/types/balance-history";
import { usdText } from "@/shared/lib/money";

export function BalanceChange({ series }: { series: HistorySeries }) {
  const change = seriesChange(series);
  const rangeName = BALANCES_COPY.rangeNames[DEFAULT_RANGE];
  if (change === 0n) {
    return (
      <p className="text-sm text-muted">
        {BALANCES_COPY.noChange} · {rangeName}
      </p>
    );
  }
  const up = change > 0n;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <p className="flex items-center gap-1.5 text-sm">
      <span className={`inline-flex items-center gap-1 ${up ? "text-success" : "text-danger"}`}>
        <Icon aria-hidden className="size-[var(--fw-icon-sm)]" />
        <span className="tabular-nums">
          {up ? "+" : "−"}
          {usdText(change < 0n ? -change : change)}
        </span>
      </span>
      <span className="text-muted">{rangeName}</span>
    </p>
  );
}
