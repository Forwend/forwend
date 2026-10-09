"use client";

import { useAppSession } from "@/components/app/active-profile";
import { ActivityList } from "@/components/app/activity-list";

export default function ActivityPage() {
  const { profile, token } = useAppSession();
  return <ActivityList profileId={profile.profileId} token={token} />;
}
