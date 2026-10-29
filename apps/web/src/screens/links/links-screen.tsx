"use client";

import { LinksTable } from "@/features/links/components/links-table";
import { PERMISSIONS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can } from "@/features/profiles/lib/profile";

export function LinksScreen() {
  const { profile } = useAppSession();
  return (
    <LinksTable
      key={profile.profileId}
      profileId={profile.profileId}
      canWrite={can(profile, PERMISSIONS.invoicesWrite)}
    />
  );
}
