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
import { PageTitle } from "@/shared/components/page-title";
import { APP_ROUTES } from "@/shared/config/routes";

// The shell's guard keeps out roles without the keys permission.
export function DevelopersScreen() {
  const { profile } = useAppSession();
  const personal = profile.kind === PROFILE_KINDS.personal;
  return (
    // One key for the page: a profile switch starts both sections afresh.
    <div key={profile.profileId} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <PageTitle>{COPY.title}</PageTitle>
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
