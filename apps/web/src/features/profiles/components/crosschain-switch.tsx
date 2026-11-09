"use client";

import { SwitchCard } from "@forwend/ui-web";
import {
  useGetCrossChainSwitchQuery,
  useSaveCrossChainSwitchMutation,
} from "@/features/profiles/api/profiles-api";
import { TOKENS_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import type { TokenSwitch } from "@/features/profiles/types/tokens";

export interface CrossChainSwitchProps {
  profileId: string;
  /** The saved token switches: the route saves the switch with the tokens off. */
  saved: readonly TokenSwitch[];
}

/** R-240: on by default; off, no new quote is made, and an open one still finishes. */
export function CrossChainSwitch({ profileId, saved }: CrossChainSwitchProps) {
  const on = useGetCrossChainSwitchQuery(profileId);
  const [save, { isLoading, isError }] = useSaveCrossChainSwitchMutation();
  if (on.currentData === undefined) return null;
  return (
    <div className="flex flex-col gap-2">
      <SwitchCard
        title={COPY.crossChain}
        description={COPY.crossChainHint}
        checked={on.currentData}
        disabled={isLoading}
        onCheckedChange={(checked) =>
          void save({
            profileId,
            on: checked,
            off: saved.filter((t) => !t.on).map(({ chainId, token }) => ({ chainId, token })),
          })
        }
      />
      {isError ? (
        <p role="alert" className="text-sm text-danger">
          {COPY.saveFailed}
        </p>
      ) : null}
    </div>
  );
}
