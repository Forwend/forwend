import { BrandIcon } from "@forwend/ui-web";
import { CHAINS, chainName } from "@/shared/chains/chains";

/** The network's logo, then its name: scanning a list by network is faster with the logo (R-64). */
export function NetworkName({ chainId }: { chainId: number }) {
  const icon = CHAINS[chainId]?.icon;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {icon ? <BrandIcon name={icon} className="size-3.5 shrink-0 rounded-sm" /> : null}
      <span className="truncate">{chainName(chainId)}</span>
    </span>
  );
}
