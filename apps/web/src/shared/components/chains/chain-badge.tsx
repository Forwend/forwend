import { BrandIcon } from "@forwend/ui-web";
import { CHAINS } from "@/shared/constants/chains";

export interface ChainBadgeProps {
  chainId: number;
  className?: string;
}

/** Whether a row has a logo badge to show the network; without one the row names it in text. */
export const hasChainBadge = (chainId: number) => Boolean(CHAINS[chainId]?.icon);

/** The network's logo on a round row icon's corner; the row must name the network for screen readers. */
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
