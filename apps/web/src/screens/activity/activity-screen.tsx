"use client";

import { ActivityList } from "@/features/activity/components/activity-list";
import { NewInvoiceLink } from "@/features/invoices/components/new-invoice-link";
import { PERMISSIONS, PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can } from "@/features/profiles/lib/profile";

export function ActivityScreen() {
  const { profile, openRequest } = useAppSession();
  return (
    <ActivityList
      profileId={profile.profileId}
      emptyAction={
        can(profile, PERMISSIONS.invoicesWrite) ? (
          <NewInvoiceLink
            variant="secondary"
            onRequest={profile.kind === PROFILE_KINDS.personal ? openRequest : undefined}
          />
        ) : undefined
      }
    />
  );
}
