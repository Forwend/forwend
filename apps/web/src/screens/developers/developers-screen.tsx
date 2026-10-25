"use client";

import { ApiKeys } from "@/features/api-keys/components/api-keys";
import { API_KEYS_COPY as COPY } from "@/features/api-keys/constants/api-keys-copy";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";

// R-145: the shell's guard keeps out a role without the keys permission; a personal profile has no API (R-144).
export function DevelopersScreen() {
  const { profile } = useAppSession();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
        <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">{COPY.title}</h1>
        <p className="text-muted">
          {profile.kind === PROFILE_KINDS.personal ? COPY.notPersonal : COPY.intro}
        </p>
      </div>
      {profile.kind === PROFILE_KINDS.personal ? null : (
        <ApiKeys
          key={profile.profileId}
          profileId={profile.profileId}
          merchant={profile.kind === PROFILE_KINDS.merchant}
        />
      )}
    </div>
  );
}
