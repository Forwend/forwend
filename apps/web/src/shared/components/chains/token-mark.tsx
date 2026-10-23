import { BrandIcon } from "@forwend/ui-web";
import { CHAINS, TOKEN_ICONS } from "@/shared/constants/chains";
import { chainName } from "@/shared/lib/chains";

export interface TokenMarkProps {
  chainId: number;
  symbol: string;
}

export function TokenMark({ chainId, symbol }: TokenMarkProps) {
  const token = TOKEN_ICONS[symbol];
  const chain = CHAINS[chainId]?.icon;
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="relative size-9 shrink-0">
        {token ? (
          <BrandIcon name={token} className="size-9" />
        ) : (
          <span className="grid size-9 place-items-center rounded-pill bg-surface-2 text-xs text-muted">
            {symbol.slice(0, 1)}
          </span>
        )}
        {chain ? (
          <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-pill border-2 border-surface bg-surface">
            <BrandIcon name={chain} className="size-4 rounded-sm" />
          </span>
        ) : null}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink">{symbol}</span>
        <span className="block truncate text-xs text-muted">{chainName(chainId)}</span>
      </span>
    </span>
  );
}
