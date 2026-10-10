"use client";

import { useAppSession } from "@/features/profiles/app-session";
import { PROFILE_KINDS } from "@/features/profiles/profile";
import { BusinessOverview } from "@/screens/dashboard/business-overview";
import { PersonalOverview } from "@/screens/dashboard/personal-overview";

export function DashboardScreen() {
  const { profile } = useAppSession();
  // A new console per profile: switching between two business profiles never shows the last one's figures.
  return profile.kind === PROFILE_KINDS.personal ? (
    <PersonalOverview />
  ) : (
    <BusinessOverview key={profile.profileId} />
  );
}
