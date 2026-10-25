"use client";

import { PERMISSIONS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can } from "@/features/profiles/lib/profile";
import { StoresTable } from "@/features/stores/components/stores-table";
import { closeLabel } from "@/screens/stores/lib/close-choices";

export function StoresScreen() {
  const { profile } = useAppSession();
  return (
    <StoresTable
      key={profile.profileId}
      profileId={profile.profileId}
      closeLabel={closeLabel}
      canAdd={can(profile, PERMISSIONS.storesWrite)}
    />
  );
}
