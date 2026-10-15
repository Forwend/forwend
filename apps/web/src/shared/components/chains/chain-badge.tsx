import { BrandIcon } from "@forwend/ui-web";
import { CHAINS } from "@/shared/constants/chains";

export interface ChainBadgeProps {
  chainId: number;
  className?: string;
}

/** The network's logo on the corner of a round row icon or avatar, where a narrow row has no room for its name. The
 * row names the network for screen readers. */
export function ChainBadge({ chainId, className = "" }: ChainBadgeProps) {
  const icon = CHAINS[chainId]?.icon;
  return icon ? (
    <span
      aria-hidden
      className={`absolute -right-1 -bottom-1 grid size-4.5 place-items-center rounded-pill border-2 border-surface bg-surface ${className}`}
    >
      <BrandIcon name={icon} className="size-3.5 rounded-sm" />
    </span>
  ) : null;
}
