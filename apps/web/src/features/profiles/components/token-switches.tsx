"use client";

import { useSaveProfileTokensMutation } from "@/features/profiles/api/profiles-api";
import { SaveStatus } from "@/features/profiles/components/save-status";
import { TOKENS_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import type { TokenSwitch } from "@/features/profiles/types/tokens";
import { AssetSelection, assetKey } from "@/shared/components/chains/asset-selection";

export interface TokenSwitchesProps {
  profileId: string;
  saved: readonly TokenSwitch[];
}

export function TokenSwitches({ profileId, saved }: TokenSwitchesProps) {
  const [save, { isLoading, isError, isSuccess }] = useSaveProfileTokensMutation();
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
    try {
      await save({ profileId, off }).unwrap();
    } catch {
      // Shown below.
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <AssetSelection
        label={COPY.title}
        options={saved}
        selected={selected}
        onChange={(keys, on) => void change(keys, on)}
        lockedReason={() => (selected.size === 1 ? COPY.lastOn : null)}
      />
      <SaveStatus saving={isLoading} saved={isSuccess} failed={isError} />
    </div>
  );
}
