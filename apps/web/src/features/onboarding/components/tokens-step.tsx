"use client";

import { Notice, Skeleton } from "@forwend/ui-web";
import { TEST_USDC_FAUCET } from "@/features/onboarding/constants/onboarding";
import { FIRST_RUN_COPY } from "@/features/onboarding/constants/onboarding-copy";
import type { TokenSwitch } from "@/features/profiles/types/tokens";
import { AssetSelection } from "@/shared/components/chains/asset-selection";
import { LoadError } from "@/shared/components/load-error";

const COPY = FIRST_RUN_COPY.tokens;

export interface TokensStepProps {
  /** Every enabled token; undefined while it loads. */
  options: readonly TokenSwitch[] | undefined;
  failed: boolean;
  onRetry: () => void;
  selected: ReadonlySet<string>;
  onChange: (keys: readonly string[], on: boolean) => void;
}

/** What payers can use, said once as test money (R-50): each token beside its network, the profile's defaults on. */
export function TokensStep({ options, failed, onRetry, selected, onChange }: TokensStepProps) {
  return (
    <div className="flex flex-col gap-5">
      <Notice>
        <strong className="font-semibold">{COPY.testnet}</strong> {COPY.testnetDetail}{" "}
        <a
          href={TEST_USDC_FAUCET}
          target="_blank"
          rel="noreferrer"
          aria-label={COPY.faucetLabel}
          className="underline underline-offset-2"
        >
          {COPY.faucet}
        </a>
      </Notice>
      {options ? (
        <AssetSelection
          label={COPY.label}
          options={options}
          selected={selected}
          onChange={onChange}
          lockedReason={() => (selected.size === 1 ? COPY.lastOn : null)}
          boxed
        />
      ) : failed ? (
        <LoadError message={COPY.failed} onRetry={onRetry} inline />
      ) : (
        <Skeleton className="h-48 w-full" aria-label={COPY.loading} />
      )}
    </div>
  );
}
