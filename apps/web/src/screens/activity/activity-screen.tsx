"use client";

import { ActivityList } from "@/features/activity/activity-list";
import { useAppSession } from "@/features/profiles/app-session";

export function ActivityScreen() {
  const { profile } = useAppSession();
  return <ActivityList profileId={profile.profileId} />;
}
