import { BrandIcon } from "@forwend/ui-web";
import { CHAINS, TOKEN_ICONS } from "@/shared/constants/chains";

export interface AssetIconProps {
  chainId: number;
  /** Left out for a network alone. */
  symbol?: string;
}

/** A 20px mark for a picker row: the token's logo with its network's on the corner, or the network's alone.
 * Decorative: the option's label names both. */
export function AssetIcon({ chainId, symbol }: AssetIconProps) {
  const chain = CHAINS[chainId]?.icon;
  if (!symbol) {
    return chain ? (
      <BrandIcon name={chain} className="size-5 rounded-sm" />
    ) : (
      <span aria-hidden className="size-5 rounded-pill bg-surface-2" />
    );
  }
  const token = TOKEN_ICONS[symbol];
  return (
    <span aria-hidden className="relative size-5 shrink-0">
      {token ? (
        <BrandIcon name={token} className="size-5" />
      ) : (
        <span className="grid size-5 place-items-center rounded-pill bg-surface-2 text-[0.625rem] text-muted">
          {symbol.slice(0, 1)}
        </span>
      )}
      {chain ? (
        <span className="absolute -right-1 -bottom-1 grid size-3 place-items-center rounded-pill bg-surface">
          <BrandIcon name={chain} className="size-2.5 rounded-[2px]" />
        </span>
      ) : null}
    </span>
  );
}
