"use client";

import { Skeleton } from "@forwend/ui-web";
import { useGetProfileTokensQuery } from "@/features/profiles/api/profiles-api";
import { CrossChainSwitch } from "@/features/profiles/components/crosschain-switch";
import { TokenSwitches } from "@/features/profiles/components/token-switches";
import { TOKENS_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { LoadError } from "@/shared/components/load-error";
import { SETTINGS_TITLE, SettingsGroup } from "@/shared/components/settings-group";

export function NetworksScreen() {
  const { profile } = useAppSession();
  const tokens = useGetProfileTokensQuery(profile.profileId);
  return (
    <div className="flex flex-col gap-6">
      <h1 className={SETTINGS_TITLE}>{COPY.title}</h1>
      {tokens.isError ? (
        <LoadError
          message={COPY.loadFailed}
          retrying={tokens.isFetching}
          onRetry={() => void tokens.refetch()}
        />
      ) : tokens.currentData === undefined ? (
        <ul aria-hidden className="fw-panel divide-y divide-line">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex min-h-14 items-center justify-between gap-4 px-4 sm:px-5">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-6 w-11 rounded-pill" />
            </li>
          ))}
        </ul>
      ) : (
        <>
          <SettingsGroup note={COPY.note}>
            <TokenSwitches
              key={profile.profileId}
              profileId={profile.profileId}
              saved={tokens.currentData}
            />
          </SettingsGroup>
          <CrossChainSwitch profileId={profile.profileId} />
        </>
      )}
    </div>
  );
}
