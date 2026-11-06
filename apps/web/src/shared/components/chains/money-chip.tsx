import { BrandIcon } from "@forwend/ui-web";
import { TOKEN_ICONS } from "@/shared/constants/chains";
import { chainName } from "@/shared/lib/chains";

/** What is sent or received, in one line: the token's mark, its symbol and its network (Send, Receive). */
export function MoneyChip({ chainId, symbol }: { chainId: number; symbol: string }) {
  const icon = TOKEN_ICONS[symbol];
  return (
    <span className="inline-flex items-center gap-2 rounded-pill border border-line py-1 pr-3 pl-1 text-sm">
      {icon ? (
        <BrandIcon name={icon} className="size-6" />
      ) : (
        <span aria-hidden className="size-6 rounded-pill bg-surface-2" />
      )}
      <span className="font-medium text-ink">{symbol}</span>
      <span className="text-muted">{chainName(chainId)}</span>
    </span>
  );
}
