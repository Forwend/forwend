import { BrandIcon, type BrandIconName } from "@forwend/ui-web";
import { StoredLogo } from "@/shared/components/chains/stored-logo";
import { CHAINS, TOKEN_ICONS } from "@/shared/constants/chains";
import { chainName } from "@/shared/lib/chains";

export interface TokenMarkProps {
  chainId: number;
  symbol: string;
}

export function TokenMark({ chainId, symbol }: TokenMarkProps) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <MarkIcon
        token={TOKEN_ICONS[symbol]}
        chain={CHAINS[chainId]?.icon}
        letter={symbol.slice(0, 1)}
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink">{symbol}</span>
        <span className="block truncate text-xs text-muted">{chainName(chainId)}</span>
      </span>
    </span>
  );
}

export interface MarkIconProps {
  token: BrandIconName | undefined;
  chain: BrandIconName | undefined;
  /** Stands in for a token Forwend draws no logo for. */
  letter: string;
  /** A logo file the web ships, for a token Forwend draws none for itself. */
  logo?: string | null;
  /** The same for the network on the corner. */
  chainLogo?: string | null;
}

/** A token's 36px logo with its network's on the corner. Decorative: the text beside it names both. */
export function MarkIcon({ token, chain, letter, logo, chainLogo }: MarkIconProps) {
  return (
    <span aria-hidden className="relative block size-9 shrink-0">
      {token ? (
        <BrandIcon name={token} className="size-9" />
      ) : logo ? (
        <StoredLogo src={logo} letter={letter} className="size-9" />
      ) : (
        <span className="grid size-9 place-items-center rounded-pill bg-surface-2 text-xs text-muted">
          {letter}
        </span>
      )}
      {chain || chainLogo ? (
        <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-pill border-2 border-surface bg-surface">
          {chain ? (
            <BrandIcon name={chain} className="size-4 rounded-sm" />
          ) : chainLogo ? (
            <StoredLogo src={chainLogo} letter="" className="size-4" />
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
