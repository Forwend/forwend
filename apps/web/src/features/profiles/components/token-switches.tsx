"use client";

import { useSaveProfileTokensMutation } from "@/features/profiles/api/profiles-api";
import { TOKENS_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import type { TokenSwitch } from "@/features/profiles/types/tokens";
import { AssetSelection, assetKey } from "@/shared/components/chains/asset-selection";

export interface TokenSwitchesProps {
  profileId: string;
  saved: readonly TokenSwitch[];
}

// R-136: each change saves at once, said by one quiet line rather than a toast per box. The last token on can't be
// turned off, as the API refuses it.
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
      <p role="status" className="min-h-5 text-sm text-muted">
        {isLoading ? COPY.saving : isError ? null : isSuccess ? COPY.savedAll : null}
      </p>
      {isError ? (
        <p role="alert" className="text-sm text-danger">
          {COPY.saveFailed}
        </p>
      ) : null}
    </div>
  );
}
