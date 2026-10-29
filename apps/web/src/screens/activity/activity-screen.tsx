"use client";

import { ActivityList } from "@/features/activity/components/activity-list";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";

export function ActivityScreen() {
  const { profile } = useAppSession();
  return <ActivityList profileId={profile.profileId} />;
}
