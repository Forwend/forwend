"use client";

import { formatTokenAmount, RowButton, SearchField, Sheet, Skeleton } from "@forwend/ui-web";
import { useMemo, useState } from "react";
import { PAY_COPY } from "@/features/pay/constants/pay-copy";
import { orderBlockchains } from "@/features/pay/lib/crosschain";
import type { CrossToken } from "@/features/pay/types/crosschain";
import { blockchainName } from "@/shared/lib/chains";

const COPY = PAY_COPY.crossChain;

export interface CrossChainPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** As the api lists them: stablecoins first. Undefined while they load. */
  tokens: readonly CrossToken[] | undefined;
  /** What is due, in Base USDC base units: a token NEAR Intents needs more from can't be picked (D-126). */
  due: bigint | undefined;
  dueDecimals: number;
  onPick: (token: CrossToken) => void;
}

const matches = (query: string, ...texts: string[]) =>
  texts.some((text) => text.toLowerCase().includes(query.trim().toLowerCase()));

/** Chains beside the chosen chain's tokens (R-236); on phones the chains are a row of chips above the tokens. */
export function CrossChainPicker({
  open,
  onOpenChange,
  tokens,
  due,
  dueDecimals,
  onPick,
}: CrossChainPickerProps) {
  const chains = useMemo(() => orderBlockchains((tokens ?? []).map((t) => t.blockchain)), [tokens]);
  const [chosen, setChosen] = useState<string>();
  const [chainQuery, setChainQuery] = useState("");
  const [tokenQuery, setTokenQuery] = useState("");
  const chain = chosen && chains.includes(chosen) ? chosen : chains[0];
  const shownChains = chains.filter((c) => matches(chainQuery, c, blockchainName(c)));
  const minimumOver = (t: CrossToken) =>
    due !== undefined && t.minimum != null && BigInt(t.minimum) > due ? BigInt(t.minimum) : null;
  const usdc = (units: bigint) =>
    `${formatTokenAmount({ baseUnits: units, decimals: dueDecimals, fractionDigits: 2 })} USDC`;
  // A search names a token on any chain, so a payer who knows the token finds it without the chain. Tokens that fit
  // come first; the rest stay listed, with what they need.
  const shownTokens = (tokens ?? [])
    .filter((t) =>
      tokenQuery
        ? matches(tokenQuery, t.symbol, blockchainName(t.blockchain))
        : t.blockchain === chain,
    )
    .sort((a, b) => Number(minimumOver(a) !== null) - Number(minimumOver(b) !== null));
  const someTooSmall = due !== undefined && shownTokens.some((t) => minimumOver(t) !== null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={COPY.pickerTitle} size="lg">
      {tokens === undefined ? (
        <div aria-busy="true" className="flex flex-col gap-2 pb-5">
          <span className="sr-only">{COPY.loadingTokens}</span>
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : tokens.length === 0 ? (
        <p className="pb-5 text-sm text-muted">{COPY.noTokens}</p>
      ) : (
        <div className="flex min-h-0 flex-col gap-3 pb-5">
          <div className="grid min-h-0 gap-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-5">
            <section aria-label={COPY.chains} className="flex min-w-0 flex-col gap-2">
              <SearchField
                label={COPY.searchChains}
                placeholder={COPY.searchChains}
                value={chainQuery}
                onValueChange={setChainQuery}
                className="max-sm:hidden"
              />
              {/* Phones: one scrolling row of chips; from small screens a list beside the tokens. */}
              <ul className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:max-h-80 sm:flex-col sm:gap-0.5 sm:overflow-y-auto sm:px-0">
                {shownChains.map((c) => (
                  <li key={c} className="shrink-0">
                    <button
                      type="button"
                      aria-pressed={c === chain && !tokenQuery}
                      onClick={() => {
                        setChosen(c);
                        setTokenQuery("");
                      }}
                      className="flex w-full items-center gap-2 rounded-pill border border-line px-3 py-1.5 text-sm text-ink outline-none transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus aria-pressed:border-ink aria-pressed:bg-surface-2 sm:rounded-md sm:border-transparent sm:px-2 sm:py-2 sm:aria-pressed:border-transparent"
                    >
                      <Mark text={blockchainName(c)} />
                      {blockchainName(c)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section
              aria-label={
                tokenQuery ? COPY.searchTokens : COPY.tokensOn(blockchainName(chain ?? ""))
              }
              className="flex min-w-0 flex-col gap-2"
            >
              <SearchField
                label={COPY.searchTokens}
                placeholder={COPY.searchTokens}
                value={tokenQuery}
                onValueChange={setTokenQuery}
              />
              {shownTokens.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted">{COPY.noMatch}</p>
              ) : (
                <ul className="flex flex-col sm:max-h-80 sm:overflow-y-auto">
                  {shownTokens.map((t) => {
                    const minimum = minimumOver(t);
                    return (
                      <li key={t.assetId}>
                        <RowButton
                          disabled={minimum !== null}
                          className="disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent"
                          onClick={() => {
                            onPick(t);
                            onOpenChange(false);
                          }}
                        >
                          <Mark text={t.symbol} />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="font-medium">{t.symbol}</span>
                            <span className="text-xs text-muted">
                              {minimum === null
                                ? blockchainName(t.blockchain)
                                : `${blockchainName(t.blockchain)} · ${COPY.needsAtLeast(usdc(minimum))}`}
                            </span>
                          </span>
                          {minimum === null && t.estimate ? (
                            <span className="shrink-0 text-sm text-muted tabular-nums">
                              {COPY.estimate(
                                `${formatTokenAmount({
                                  baseUnits: BigInt(t.estimate),
                                  decimals: t.decimals,
                                  // An estimate: cents for a whole token or more, a few digits below one.
                                  fractionDigits:
                                    BigInt(t.estimate) >= 10n ** BigInt(t.decimals)
                                      ? 2
                                      : Math.min(t.decimals, 6),
                                })} ${t.symbol}`,
                              )}
                            </span>
                          ) : null}
                        </RowButton>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
          {someTooSmall ? (
            <p className="border-t border-line pt-3 text-xs text-muted">
              {COPY.tooSmall(usdc(due))}
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

// 1Click lists hundreds of tokens Forwend has no logo for: its first letter stands in, in the place a logo takes.
function Mark({ text }: { text: string }) {
  return (
    <span
      aria-hidden
      className="grid size-6 shrink-0 place-items-center rounded-pill bg-surface-2 text-xs font-medium text-muted"
    >
      {text.slice(0, 1)}
    </span>
  );
}
