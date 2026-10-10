import { BrandIcon, type BrandIconName } from "../../icons/brand-icon";

export interface TokenChipProps {
  token: string;
  network: string;
}

const TOKEN_LOGOS: Partial<Record<string, BrandIconName>> = { USDC: "usdc", USDT: "usdt" };

const NETWORK_LOGOS: Partial<Record<string, BrandIconName>> = {
  Base: "base",
  Arbitrum: "arbitrum",
  Arc: "arc",
  Tempo: "tempo",
};

export function TokenChip({ token, network }: TokenChipProps) {
  const tokenLogo = TOKEN_LOGOS[token];
  const networkLogo = NETWORK_LOGOS[network];
  return (
    <span className="inline-flex items-center overflow-hidden rounded-pill border border-line text-xs font-medium">
      <span className="inline-flex items-center gap-1.5 bg-surface px-2.5 py-1 text-ink">
        {tokenLogo ? <BrandIcon name={tokenLogo} className="size-[var(--fw-icon-sm)]" /> : null}
        {token}
      </span>
      <span className="inline-flex items-center gap-1.5 border-l border-line bg-surface-2 px-2.5 py-1 text-muted">
        {networkLogo ? <BrandIcon name={networkLogo} className="size-3.5" /> : null}
        {network}
      </span>
    </span>
  );
}
