"use client";

import { SwitchCard } from "@forwend/ui-web";
import {
  useGetCrossChainSwitchQuery,
  useSaveCrossChainSwitchMutation,
} from "@/features/profiles/api/profiles-api";
import { TOKENS_COPY as COPY } from "@/features/profiles/constants/profiles-copy";

export interface CrossChainSwitchProps {
  profileId: string;
}

/** R-240: on by default; off, no new quote is made, and an open one still finishes. */
export function CrossChainSwitch({ profileId }: CrossChainSwitchProps) {
  const on = useGetCrossChainSwitchQuery(profileId);
  const [save, { isLoading, isError, isSuccess }] = useSaveCrossChainSwitchMutation();
  if (on.currentData === undefined) return null;
  return (
    <div className="flex flex-col gap-2">
      <SwitchCard
        title={COPY.crossChain}
        description={COPY.crossChainHint}
        checked={on.currentData}
        onCheckedChange={(checked) => void save({ profileId, on: checked })}
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
