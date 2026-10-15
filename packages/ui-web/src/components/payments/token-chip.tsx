import { BrandIcon, type BrandIconName } from "../../icons/brand-icon";

export interface TokenChipProps {
  token: string;
  network: string;
}

const TOKEN_LOGOS: Partial<Record<string, BrandIconName>> = {
  USDC: "usdc",
  USDT: "usdt",
  OUSD: "ousd",
};

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
    <span className="inline-flex max-w-full items-center overflow-hidden whitespace-nowrap rounded-md border border-line text-xs font-medium">
      <span className="inline-flex shrink-0 items-center gap-1.5 bg-surface px-2.5 py-1 text-ink">
        {tokenLogo ? <BrandIcon name={tokenLogo} className="size-[var(--fw-icon-sm)]" /> : null}
        {token}
      </span>
      <span className="sr-only"> on </span>
      <span
        title={network}
        className="inline-flex min-w-0 items-center gap-1.5 border-l border-line bg-surface-2 px-2.5 py-1 text-muted"
      >
        {networkLogo ? (
          <BrandIcon name={networkLogo} className="size-[var(--fw-icon-sm)] shrink-0" />
        ) : null}
        <span className="truncate">{network}</span>
      </span>
    </span>
  );
}
