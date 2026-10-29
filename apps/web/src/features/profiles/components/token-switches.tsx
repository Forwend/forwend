"use client";

import { SearchField, Switch, TONES, useToast } from "@forwend/ui-web";
import { useState } from "react";
import { useSaveProfileTokensMutation } from "@/features/profiles/api/profiles-api";
import { TOKENS_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import type { TokenSwitch } from "@/features/profiles/types/tokens";
import { NoMatch } from "@/shared/components/no-match";
import { chainName, TOKEN_SEARCH_FROM, tokenMatches } from "@/shared/lib/chains";

export interface TokenSwitchesProps {
  profileId: string;
  saved: readonly TokenSwitch[];
}

// R-136: each switch saves at once. The last token on can't be turned off, as the API refuses it.
export function TokenSwitches({ profileId, saved }: TokenSwitchesProps) {
  const [save, { isLoading, isError }] = useSaveProfileTokensMutation();
  const toast = useToast();
  const onCount = saved.filter((t) => t.on).length;
  const [query, setQuery] = useState("");
  const shown = saved.filter((t) => tokenMatches(t, query));
  const flip = async (flipped: TokenSwitch, on: boolean) => {
    const off = saved
      .filter((t) => (t === flipped ? !on : !t.on))
      .map(({ chainId, token }) => ({ chainId, token }));
    try {
      await save({ profileId, off }).unwrap();
      toast({
        tone: TONES.success,
        title: COPY.saved(flipped.symbol, chainName(flipped.chainId), on),
      });
    } catch {
      // Said below; the switch stays as saved.
    }
  };
  return (
    <div className="fw-panel flex flex-col">
      {saved.length > TOKEN_SEARCH_FROM ? (
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <SearchField
            label={COPY.search}
            placeholder={COPY.searchPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
        </div>
      ) : null}
      {shown.length === 0 ? (
        <NoMatch compact onClear={() => setQuery("")} clearLabel={COPY.clearSearch} />
      ) : null}
      <ul className="divide-y divide-line">
        {shown.map((t) => {
          const last = t.on && onCount === 1;
          return (
            <li key={`${t.chainId}:${t.token}`} className="px-4 py-1.5 sm:px-5">
              <Switch
                label={COPY.toggle(t.symbol, chainName(t.chainId))}
                checked={t.on}
                onCheckedChange={(on) => void flip(t, on)}
                disabled={isLoading || last}
                className="w-full flex-row-reverse justify-between font-medium text-ink"
              />
              {/* Why this one can't be turned off, under the switch it holds on. */}
              {last ? <p className="-mt-1 pb-2 text-sm text-muted">{COPY.lastOn}</p> : null}
            </li>
          );
        })}
      </ul>
      {isError ? (
        <p role="alert" className="border-t border-line px-4 py-3 text-sm text-danger sm:px-5">
          {COPY.saveFailed}
        </p>
      ) : null}
    </div>
  );
}
