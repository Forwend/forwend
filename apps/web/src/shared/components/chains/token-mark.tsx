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
  /** 24px, to sit in a line of text. */
  small?: boolean;
}

/** A token's 36px logo with its network's on the corner. Decorative: the text beside it names both. */
export function MarkIcon({ token, chain, letter, logo, chainLogo, small }: MarkIconProps) {
  const size = small ? "size-6" : "size-9";
  const corner = small ? "size-2.5" : "size-4";
  return (
    <span aria-hidden className={`relative block shrink-0 ${size}`}>
      {token ? (
        <BrandIcon name={token} className={size} />
      ) : logo ? (
        <StoredLogo src={logo} letter={letter} className={size} />
      ) : (
        <span
          className={`grid place-items-center rounded-pill bg-surface-2 text-xs text-muted ${size}`}
        >
          {letter}
        </span>
      )}
      {chain || chainLogo ? (
        <span
          className={`absolute -right-1 -bottom-1 grid place-items-center rounded-pill border-surface bg-surface ${small ? "size-3.5 border" : "size-5 border-2"}`}
        >
          {chain ? (
            <BrandIcon name={chain} className={`rounded-sm ${corner}`} />
          ) : chainLogo ? (
            <StoredLogo src={chainLogo} letter="" className={corner} />
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
