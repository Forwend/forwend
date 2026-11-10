"use client";

import {
  BrandIcon,
  type BrandIconName,
  formatTokenAmount,
  RowButton,
  SearchField,
  Sheet,
  Skeleton,
} from "@forwend/ui-web";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PAY_COPY } from "@/features/pay/constants/pay-copy";
import { amountText, orderBlockchains, sendUnits } from "@/features/pay/lib/crosschain";
import type { CrossToken } from "@/features/pay/types/crosschain";
import { StoredLogo } from "@/shared/components/chains/stored-logo";
import { BLOCKCHAIN_ICONS, CROSS_CHAIN_TOKEN_ICONS } from "@/shared/constants/chains";
import { blockchainName, chainLogo, iconOf, tokenLogo } from "@/shared/lib/chains";

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

const STEPS = { chains: "chains", tokens: "tokens" } as const;
// A list that takes another's place fades in from a slight blur: the content changes, not the place.
const STEP_IN = "motion-safe:animate-[fw-step-in_var(--fw-duration-base)_var(--fw-ease-out)]";

/** Networks beside the chosen network's tokens (R-236). A phone has no room for both: it shows the networks first,
 * then the chosen one's tokens with a way back. A token search looks across every network at either step. */
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
  // The phone's step; from small screens up both lists show and it changes nothing.
  const [step, setStep] = useState<(typeof STEPS)[keyof typeof STEPS]>(STEPS.chains);
  const back = useRef<HTMLButtonElement>(null);
  const chainList = useRef<HTMLUListElement>(null);
  // The list a tap led to takes the focus the tapped row had: Back on the way in, the network on the way out.
  const stepped = useRef(false);
  useEffect(() => {
    if (!stepped.current) return;
    stepped.current = false;
    if (step === STEPS.tokens) back.current?.focus();
    else chainList.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
  }, [step]);
  const go = (next: typeof step) => {
    stepped.current = true;
    setStep(next);
  };
  const [chainQuery, setChainQuery] = useState("");
  const [tokenQuery, setTokenQuery] = useState("");
  const chain = chosen && chains.includes(chosen) ? chosen : chains[0];
  const shownChains = chains.filter((c) => matches(chainQuery, c, blockchainName(c)));
  const counts = useMemo(() => {
    const byChain = new Map<string, number>();
    for (const t of tokens ?? []) byChain.set(t.blockchain, (byChain.get(t.blockchain) ?? 0) + 1);
    return byChain;
  }, [tokens]);
  const minimumOver = (t: CrossToken) =>
    due !== undefined && t.minimum != null && BigInt(t.minimum) > due ? BigInt(t.minimum) : null;
  // A minimum shown short would invite too small a payment: it rounds up to the cent.
  const cent = 10n ** BigInt(Math.max(dueDecimals - 2, 0));
  const centsUp = (units: bigint) => ((units + cent - 1n) / cent) * cent;
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
  // On a phone: the networks until one is tapped; a search shows its tokens from every network at once.
  const tokensOnPhone = step === STEPS.tokens || tokenQuery !== "";
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={COPY.pickerTitle} size="lg">
      {tokens === undefined ? (
        <div aria-busy="true" className="flex flex-col gap-2 pb-5">
          <span className="sr-only">{COPY.loadingTokens}</span>
          <Skeleton className="h-10" />
          {LOADING_ROWS.map((row) => (
            <div key={row} aria-hidden className="flex min-h-12 items-center gap-3 px-2">
              <Skeleton className="size-6 rounded-pill" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="ml-auto h-4 w-20" />
            </div>
          ))}
        </div>
      ) : tokens.length === 0 ? (
        <p className="pb-5 text-sm text-muted">{COPY.noTokens}</p>
      ) : (
        <div className="flex min-h-0 flex-col gap-3 pb-5">
          <div className="grid min-h-0 gap-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-5">
            <section
              aria-label={COPY.chains}
              className={`flex min-w-0 flex-col gap-2 ${tokensOnPhone ? "max-sm:hidden" : ""}`}
            >
              <SearchField
                label={COPY.searchChains}
                placeholder={COPY.searchChains}
                value={chainQuery}
                onValueChange={setChainQuery}
                className="max-sm:hidden"
              />
              {/* Phones: full rows, each with how many tokens it has; from small screens a list beside the tokens. */}
              <ul
                ref={chainList}
                className={`flex flex-col gap-0.5 sm:max-h-80 sm:overflow-y-auto ${STEP_IN}`}
              >
                {shownChains.map((c) => (
                  <li key={c}>
                    <button
                      type="button"
                      aria-pressed={c === chain && !tokenQuery}
                      onClick={() => {
                        setChosen(c);
                        setTokenQuery("");
                        go(STEPS.tokens);
                      }}
                      className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm text-ink outline-none transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus sm:min-h-0 sm:gap-2 sm:aria-pressed:bg-surface-2"
                    >
                      <Mark
                        text={blockchainName(c)}
                        icon={iconOf(BLOCKCHAIN_ICONS, c)}
                        logo={chainLogo(c)}
                      />
                      <span className="min-w-0 flex-1 truncate">{blockchainName(c)}</span>
                      {/* A hint for the eye: the button's name stays the network's alone. */}
                      <span
                        aria-hidden
                        className="flex shrink-0 items-center gap-1 text-xs text-muted sm:hidden"
                      >
                        {COPY.tokenCount(counts.get(c) ?? 0)}
                        <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)]" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section
              aria-label={
                tokenQuery ? COPY.searchTokens : COPY.tokensOn(blockchainName(chain ?? ""))
              }
              className="flex min-w-0 flex-col gap-2 max-sm:order-first"
            >
              {step === STEPS.tokens && !tokenQuery ? (
                <button
                  ref={back}
                  type="button"
                  onClick={() => go(STEPS.chains)}
                  className="-ml-1 flex min-h-11 items-center gap-1.5 self-start rounded-sm pr-2 text-sm font-medium text-ink outline-none hover:text-muted focus-visible:outline-2 focus-visible:outline-focus sm:hidden"
                >
                  <ChevronLeft aria-hidden className="size-[var(--fw-icon-sm)] text-muted" />
                  <span className="sr-only">{COPY.backToChains}: </span>
                  <Mark
                    text={blockchainName(chain ?? "")}
                    icon={iconOf(BLOCKCHAIN_ICONS, chain ?? "")}
                  />
                  {blockchainName(chain ?? "")}
                </button>
              ) : null}
              <SearchField
                label={COPY.searchTokens}
                placeholder={COPY.searchTokens}
                value={tokenQuery}
                onValueChange={setTokenQuery}
              />
              {shownTokens.length === 0 ? (
                <p
                  className={`px-2 py-3 text-sm text-muted ${tokensOnPhone ? "" : "max-sm:hidden"}`}
                >
                  {COPY.noMatch}
                </p>
              ) : (
                <ul
                  // A new network's tokens are a new list: it fades in, on any screen.
                  key={tokenQuery ? "search" : chain}
                  className={`flex flex-col sm:max-h-80 sm:overflow-y-auto ${STEP_IN} ${tokensOnPhone ? "" : "max-sm:hidden"}`}
                >
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
                            // The next opening starts at the networks again.
                            setStep(STEPS.chains);
                            setTokenQuery("");
                            setChainQuery("");
                          }}
                        >
                          <Mark
                            text={t.symbol}
                            icon={iconOf(CROSS_CHAIN_TOKEN_ICONS, t.symbol)}
                            logo={tokenLogo(t.coingeckoId)}
                            greyed={minimum !== null}
                          />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate font-medium">{t.symbol}</span>
                            <span className="text-xs text-muted">
                              {minimum === null
                                ? blockchainName(t.blockchain)
                                : `${blockchainName(t.blockchain)} · ${COPY.needsAtLeast(usdc(centsUp(minimum)))}`}
                            </span>
                          </span>
                          {minimum === null && t.estimate ? (
                            <span className="shrink-0 text-sm text-muted tabular-nums">
                              {COPY.estimate(
                                amountText(
                                  sendUnits(BigInt(t.estimate), t.decimals, Number(t.priceUsd)),
                                  t,
                                ),
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
        </div>
      )}
    </Sheet>
  );
}

// The usual first screen of rows, so the sheet opens at about the height it will keep.
const LOADING_ROWS = ["a", "b", "c", "d", "e", "f"] as const;

// Forwend draws the popular logos itself (R-246); any other token or network shows the logo file the web ships
// (R-250), and one without either shows its first letter in the place a logo takes. A token that can't be picked
// greys its logo as its row does (R-242).
function Mark({
  text,
  icon,
  logo,
  greyed = false,
}: {
  text: string;
  icon: BrandIconName | undefined;
  logo?: string | null;
  greyed?: boolean;
}) {
  const dim = greyed ? "opacity-50 grayscale" : "";
  if (icon) return <BrandIcon name={icon} className={`size-6 ${dim}`} />;
  if (logo) return <StoredLogo src={logo} letter={text.slice(0, 1)} className={`size-6 ${dim}`} />;
  return (
    <span
      aria-hidden
      className="grid size-6 shrink-0 place-items-center rounded-pill bg-surface-2 text-xs font-medium text-muted"
    >
      {text.slice(0, 1)}
    </span>
  );
}
