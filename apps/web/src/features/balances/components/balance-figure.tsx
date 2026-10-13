"use client";

import { Button, Money, Skeleton } from "@forwend/ui-web";
import type { CSSProperties } from "react";
import {
  type Balances,
  formatUsd,
  type TokenBalance,
  USD,
  usdTotal,
} from "@/features/balances/balances";
import { BALANCES_COPY } from "@/features/balances/balances-copy";
import { EstimateHint } from "@/features/balances/components/estimate-hint";

// Never a made-up 0 while loading or when a read failed. The parent is the size container: the figure and its
// skeleton scale with its width, and the figure also shrinks as its digits grow, so a large total never clips.
export function BalanceFigure({
  balances,
  failed,
  onRetry,
}: {
  balances: Balances | null;
  failed: boolean;
  onRetry: () => void;
}) {
  const tokens = balances?.tokens ?? [];
  const total = balances ? usdTotal(balances, "wallet") : null;
  const text = total === null ? "—" : formatUsd(total);
  const figure =
    "text-[length:clamp(2rem,min(14cqi,160cqi_/_var(--chars)),5.25rem)] leading-none font-semibold tracking-[-0.03em] text-ink";
  const align = "items-center text-center lg:items-start lg:text-left";
  const row = "flex flex-wrap items-baseline justify-center gap-x-2 lg:justify-start";

  if (!balances && failed) {
    return (
      <div role="alert" className={`flex flex-col gap-3 text-sm text-muted ${align}`}>
        {BALANCES_COPY.balancesFailed}
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {BALANCES_COPY.retry}
        </Button>
      </div>
    );
  }
  if (!balances)
    return <Skeleton className="mx-auto h-[clamp(2rem,14cqi,5.25rem)] w-56 max-w-full lg:mx-0" />;
  if (tokens.length === 0)
    return <p className={`flex ${align} text-muted`}>{BALANCES_COPY.noTokens}</p>;

  return (
    <div className={`flex w-full flex-col gap-2 ${align}`}>
      <p className={row}>
        <span className={figure} style={{ "--chars": text.length } as CSSProperties}>
          {text}
        </span>
        <span className="inline-flex items-center gap-1 text-xl font-medium whitespace-nowrap text-muted">
          {USD}
          <EstimateHint />
        </span>
      </p>
      {total === null ? <p className="text-sm text-muted">{BALANCES_COPY.unavailable}</p> : null}
      {tokens.map((t) => (
        <PendingHeld key={`${t.chainId}:${t.token}`} t={t} />
      ))}
    </div>
  );
}

function PendingHeld({ t }: { t: TokenBalance }) {
  const pending = BigInt(t.pending);
  const held = BigInt(t.held);
  return (
    <>
      {pending > 0n ? (
        <p className="text-sm text-muted">
          <Money baseUnits={pending} decimals={t.decimals} token={t.symbol} className="text-ink" />{" "}
          {BALANCES_COPY.pending}
        </p>
      ) : null}
      {held > 0n ? (
        <p className="text-sm text-muted">
          <Money baseUnits={held} decimals={t.decimals} token={t.symbol} className="text-ink" />{" "}
          {BALANCES_COPY.held}
        </p>
      ) : null}
    </>
  );
}
