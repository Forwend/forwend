"use client";

import { Switch, TONES, useToast } from "@forwend/ui-web";
import { useSaveProfileTokensMutation } from "@/features/profiles/api/profiles-api";
import { TOKENS_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import type { TokenSwitch } from "@/features/profiles/types/tokens";
import { chainName } from "@/shared/lib/chains";

export interface TokenSwitchesProps {
  profileId: string;
  saved: readonly TokenSwitch[];
}

// R-136: each switch saves at once. The last token on can't be turned off, as the API refuses it.
export function TokenSwitches({ profileId, saved }: TokenSwitchesProps) {
  const [save, { isLoading, isError }] = useSaveProfileTokensMutation();
  const toast = useToast();
  const onCount = saved.filter((t) => t.on).length;
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
      <ul className="divide-y divide-line">
        {saved.map((t) => (
          <li key={`${t.chainId}:${t.token}`} className="px-4 py-3 sm:px-5">
            <Switch
              label={COPY.toggle(t.symbol, chainName(t.chainId))}
              checked={t.on}
              onCheckedChange={(on) => void flip(t, on)}
              disabled={isLoading || (t.on && onCount === 1)}
              className="w-full flex-row-reverse justify-between font-medium text-ink"
            />
          </li>
        ))}
      </ul>
      {onCount === 1 ? <p className="px-4 pb-3 text-sm text-muted sm:px-5">{COPY.lastOn}</p> : null}
      {isError ? (
        <p role="alert" className="px-4 pb-3 text-sm text-danger sm:px-5">
          {COPY.saveFailed}
        </p>
      ) : null}
    </div>
  );
}
