"use client";

import { TONES, useToast } from "@forwend/ui-web";
import { useSaveProfileTokensMutation } from "@/features/profiles/api/profiles-api";
import { TOKENS_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import type { TokenSwitch } from "@/features/profiles/types/tokens";
import { AssetSelection, assetKey } from "@/shared/components/chains/asset-selection";
import { chainName } from "@/shared/lib/chains";

export interface TokenSwitchesProps {
  profileId: string;
  saved: readonly TokenSwitch[];
}

// R-136: each change saves at once. The last token on can't be turned off, as the API refuses it.
export function TokenSwitches({ profileId, saved }: TokenSwitchesProps) {
  const [save, { isLoading, isError }] = useSaveProfileTokensMutation();
  const toast = useToast();
  const selected = new Set(saved.filter((t) => t.on).map(assetKey));
  const change = async (keys: readonly string[], on: boolean) => {
    const next = new Set(selected);
    for (const key of keys) {
      if (on) next.add(key);
      else next.delete(key);
    }
    if (next.size === 0) return;
    const off = saved
      .filter((t) => !next.has(assetKey(t)))
      .map(({ chainId, token }) => ({ chainId, token }));
    const [first] = saved.filter((t) => keys.includes(assetKey(t)));
    try {
      await save({ profileId, off }).unwrap();
      if (first) {
        toast({
          tone: TONES.success,
          title:
            keys.length === 1
              ? COPY.saved(first.symbol, chainName(first.chainId), on)
              : COPY.savedAll(first.symbol, on),
        });
      }
    } catch {
      // Said below; the boxes stay as saved.
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <AssetSelection
        label={COPY.title}
        options={saved}
        selected={selected}
        onChange={(keys, on) => void change(keys, on)}
        disabled={isLoading}
        lockedReason={() => (selected.size === 1 ? COPY.lastOn : null)}
      />
      {isError ? (
        <p role="alert" className="text-sm text-danger">
          {COPY.saveFailed}
        </p>
      ) : null}
    </div>
  );
}
