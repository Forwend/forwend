"use client";

import { BUTTON_VARIANTS, buttonClasses } from "@forwend/ui-web";
import Link from "next/link";
import { ApiKeys } from "@/features/api-keys/components/api-keys";
import { API_KEYS_COPY as COPY } from "@/features/api-keys/constants/api-keys-copy";
import { PERMISSIONS, PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can } from "@/features/profiles/lib/profile";
import { Webhooks } from "@/features/webhooks/components/webhooks";
import { CopyValue } from "@/shared/components/copy-value";
import { APP_ROUTES } from "@/shared/config/routes";

// R-145: the shell's guard keeps out a role without the keys permission; a personal profile has no API (R-144).
// Webhooks need their own permission, which only owners and Admins have (R-149).
export function DevelopersScreen() {
  const { profile } = useAppSession();
  const personal = profile.kind === PROFILE_KINDS.personal;
  return (
    // One key for the page: a profile switch starts both sections afresh.
    <div key={profile.profileId} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
        <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">{COPY.title}</h1>
        <p className="text-sm text-muted">
          {personal ? COPY.notPersonal : COPY.intro}{" "}
          <Link href={APP_ROUTES.docs} className={buttonClasses({ variant: BUTTON_VARIANTS.link })}>
            {COPY.docs}
          </Link>
        </p>
      </div>
      {personal ? null : (
        <>
          <div className="fw-panel px-4 py-4 sm:px-5">
            <CopyValue
              label={COPY.profileId}
              value={profile.profileId}
              hint={COPY.profileIdHint}
              copyLabel={COPY.copyProfileId}
            />
          </div>
          <ApiKeys
            profileId={profile.profileId}
            merchant={profile.kind === PROFILE_KINDS.merchant}
          />
          {can(profile, PERMISSIONS.webhooks) ? (
            <Webhooks
              profileId={profile.profileId}
              merchant={profile.kind === PROFILE_KINDS.merchant}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
