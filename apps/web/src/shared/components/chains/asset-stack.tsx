import { BrandIcon } from "@forwend/ui-web";
import { TOKEN_ICONS } from "@/shared/constants/chains";

// A profile can accept hundreds of pairs: the stack shows a few tokens and a count, never a list.
const SHOWN = 4;

export interface AssetStackProps {
  assets: readonly { chainId: number; symbol: string }[];
  /** What the stack stands for, such as "4 options": the icons are decorative. */
  label: string;
}

/** Overlapping token logos, one per token whatever its networks, then "+n" and the label. */
export function AssetStack({ assets, label }: AssetStackProps) {
  const symbols = [...new Set(assets.map((a) => a.symbol))];
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      <span aria-hidden className="flex shrink-0 -space-x-2">
        {symbols.slice(0, SHOWN).map((symbol) => (
          <span
            key={symbol}
            className="grid size-6 place-items-center rounded-pill bg-surface ring-2 ring-surface"
          >
            {TOKEN_ICONS[symbol] ? (
              <BrandIcon name={TOKEN_ICONS[symbol]} className="size-6" />
            ) : (
              <span className="grid size-6 place-items-center rounded-pill bg-surface-2 text-[0.625rem] text-muted">
                {symbol.slice(0, 1)}
              </span>
            )}
          </span>
        ))}
        {symbols.length > SHOWN ? (
          <span className="grid size-6 place-items-center rounded-pill bg-surface-2 text-[0.625rem] font-medium text-muted ring-2 ring-surface">
            +{symbols.length - SHOWN}
          </span>
        ) : null}
      </span>
      <span className="truncate text-sm text-ink">{label}</span>
    </span>
  );
}
