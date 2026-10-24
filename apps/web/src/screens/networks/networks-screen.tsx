"use client";

import { Button, Skeleton } from "@forwend/ui-web";
import { useGetProfileTokensQuery } from "@/features/profiles/api/profiles-api";
import { TokenSwitches } from "@/features/profiles/components/token-switches";
import { TOKENS_COPY as COPY } from "@/features/profiles/constants/profiles-copy";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";

export function NetworksScreen() {
  const { profile } = useAppSession();
  const tokens = useGetProfileTokensQuery(profile.profileId);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
        <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">{COPY.title}</h1>
        <p className="text-muted">{COPY.intro}</p>
      </div>
      {tokens.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {COPY.loadFailed}
          <Button size="sm" variant="secondary" onClick={tokens.refetch}>
            {COPY.retry}
          </Button>
        </div>
      ) : tokens.currentData === undefined ? (
        <Skeleton className="h-24" />
      ) : (
        <TokenSwitches
          key={profile.profileId}
          profileId={profile.profileId}
          saved={tokens.currentData}
        />
      )}
    </div>
  );
}
