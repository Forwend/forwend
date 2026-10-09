"use client";

import { ActionButton, Button, formatTokenAmount, Money, Skeleton } from "@forwend/ui-web";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Landmark } from "lucide-react";
import { useEffect, useState } from "react";
import { PROFILE_PAGE_COPY as COPY } from "@/constants/profile-page";
import { chainName } from "@/lib/chain";
import type { Balances } from "@/types/app/money";

const TIME = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/** How long a disabled action's reason stays in place of the "Updated" line. */
const NOTICE_MS = 4000;

// The answer to "how much do I have": the total at display size (one token in its own unit; several as a USD
// estimate, marked), pending and held only when there is some, then the four money actions. Only Receive works today.
export function BalanceCard({
  balances,
  failed,
  updatedAt,
  onRetry,
  onReceive,
}: {
  balances: Balances | null;
  failed: boolean;
  updatedAt: Date | null;
  onRetry: () => void;
  onReceive: () => void;
}) {
  const tokens = balances?.tokens ?? [];
  const only = tokens.length === 1 ? tokens[0] : undefined;
  const [notice, setNotice] = useState("");
  // The reason shows for a moment, then the "Updated" line comes back.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <section
      aria-labelledby="balance-title"
      aria-busy={!balances && !failed}
      className="flex flex-col justify-between gap-8 rounded-lg border border-line bg-surface p-6 shadow-md sm:p-8"
    >
      <div className="flex flex-col gap-2">
        <h2 id="balance-title" className="text-sm text-muted">
          {COPY.totalBalance}
        </h2>
        {!balances && failed ? (
          <div role="alert" className="flex flex-wrap items-center gap-4 text-muted">
            {COPY.balancesFailed}
            <Button size="sm" variant="secondary" onClick={onRetry}>
              {COPY.retry}
            </Button>
          </div>
        ) : !balances ? (
          <Skeleton className="h-12 w-56" />
        ) : tokens.length === 0 ? (
          <p className="text-muted">{COPY.noTokens}</p>
        ) : only ? (
          only.wallet === null ? (
            <p className="text-muted">{COPY.unavailable}</p>
          ) : (
            <>
              <p className="flex flex-wrap items-baseline gap-x-3 text-ink">
                <span className="font-display text-section [font-variant-numeric:lining-nums_tabular-nums]">
                  {formatTokenAmount({ baseUnits: BigInt(only.wallet), decimals: only.decimals })}
                </span>
                <span className="text-xl text-muted">{only.symbol}</span>
              </p>
              <p className="text-sm text-muted">
                {COPY.inWalletOn} {chainName(only.chainId)}
              </p>
            </>
          )
        ) : (
          <>
            <p className="font-display text-section text-ink [font-variant-numeric:lining-nums_tabular-nums]">
              {balances.estimatedUsdTotal === null ? "—" : `≈ ${balances.estimatedUsdTotal}`}
              <span className="ml-2 text-xl text-muted">USD</span>
            </p>
            <p className="text-sm text-muted">
              {COPY.estimatedAcross}{" "}
              {COPY.networksCount(new Set(tokens.map((t) => t.chainId)).size)}
            </p>
          </>
        )}
        {tokens.length > 1 && tokens.some((t) => t.wallet === null) ? (
          <p className="text-sm text-muted">{COPY.unavailable}</p>
        ) : null}
        {tokens.map((t) => (
          <PendingHeld key={`${t.chainId}:${t.token}`} t={t} />
        ))}
      </div>
      <div className="flex flex-col gap-4">
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="sr-only">{COPY.actions}</legend>
          <div className="grid grid-cols-4 gap-2 sm:flex sm:gap-8">
            <ActionButton
              icon={ArrowUpRight}
              label={COPY.send}
              disabledReason={COPY.sendSoon}
              onClick={() => setNotice(COPY.sendSoon)}
            />
            <ActionButton icon={ArrowDownLeft} label={COPY.receive} primary onClick={onReceive} />
            <ActionButton
              icon={ArrowLeftRight}
              label={COPY.transfer}
              disabledReason={COPY.transferSoon}
              onClick={() => setNotice(COPY.transferSoon)}
            />
            <ActionButton
              icon={Landmark}
              label={COPY.withdraw}
              disabledReason={COPY.withdrawSoon}
              onClick={() => setNotice(COPY.withdrawSoon)}
            />
          </div>
        </fieldset>
        {/* A press on an action that is not built yet says why in the "Updated" line's place, so nothing is
            reserved while nothing is pressed; the status region announces it. */}
        {notice ? (
          <p className="text-sm text-muted">{notice}</p>
        ) : updatedAt ? (
          <p className="text-xs text-subtle">
            {COPY.updated} {TIME.format(updatedAt)}
          </p>
        ) : null}
        <p role="status" className="sr-only">
          {notice}
        </p>
      </div>
    </section>
  );
}

function PendingHeld({ t }: { t: Balances["tokens"][number] }) {
  const pending = BigInt(t.pending);
  const held = BigInt(t.held);
  return (
    <>
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
    </>
  );
}
