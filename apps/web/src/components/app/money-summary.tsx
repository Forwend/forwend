"use client";

import { Button, Money, Skeleton } from "@forwend/ui-web";
import { PROFILE_PAGE_COPY as COPY } from "@/constants/profile-page";
import { chainName } from "@/lib/chain";
import type { Balances, TokenBalance } from "@/types/app/money";

const TIME = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

// The amount in the wallet leads. Pending and held appear only when there is some, each in plain words (PRODUCT:
// available money apart from held money); the USD total is marked as an estimate.
export function MoneySummary({
  balances,
  failed,
  updatedAt,
  onRetry,
}: {
  balances: Balances | null;
  failed: boolean;
  updatedAt: Date | null;
  onRetry: () => void;
}) {
  return (
    <section
      aria-labelledby="balance-title"
      aria-busy={!balances && !failed}
      className="flex flex-col gap-4"
    >
      <h2 id="balance-title" className="sr-only">
        {COPY.balance}
      </h2>
      {!balances && failed ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-muted">
          {COPY.balancesFailed}
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {COPY.retry}
          </Button>
        </div>
      ) : !balances ? (
        <Skeleton className="h-24 max-w-sm" />
      ) : balances.tokens.length === 0 ? (
        <p className="text-muted">{COPY.noTokens}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-6">
            {balances.tokens.map((t) => (
              <TokenLine key={`${t.chainId}:${t.token}`} t={t} />
            ))}
          </ul>
          {/* With one token the USD estimate only repeats its amount; with several it is the one number that adds up. */}
          {balances.tokens.length > 1 ? (
            <p className="text-sm text-muted">
              {COPY.estimatedTotal}{" "}
              <span className="font-mono text-ink tabular-nums">
                {balances.estimatedUsdTotal === null ? "—" : `≈ ${balances.estimatedUsdTotal} USD`}
              </span>
              , {COPY.estimatedNote}
            </p>
          ) : null}
          {updatedAt ? (
            <p className="text-sm text-subtle">
              {COPY.updated} {TIME.format(updatedAt)}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function TokenLine({ t }: { t: TokenBalance }) {
  const pending = BigInt(t.pending);
  const held = BigInt(t.held);
  return (
    <li className="flex flex-col gap-2">
      {t.wallet === null ? (
        <p className="text-muted">{COPY.unavailable}</p>
      ) : (
        <Money
          baseUnits={BigInt(t.wallet)}
          decimals={t.decimals}
          token={t.symbol}
          className="text-amount text-ink"
        />
      )}
      <p className="text-sm text-muted">
        {COPY.inWallet} {chainName(t.chainId)}
      </p>
      {pending > 0n ? (
        <p className="text-sm text-muted">
          <Money baseUnits={pending} decimals={t.decimals} token={t.symbol} className="text-ink" />{" "}
          {COPY.pending}
        </p>
      ) : null}
      {held > 0n ? (
        <p className="text-sm text-muted">
          <Money baseUnits={held} decimals={t.decimals} token={t.symbol} className="text-ink" />{" "}
          {COPY.held}
        </p>
      ) : null}
    </li>
  );
}
