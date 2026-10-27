"use client";

import { ActivityList } from "@/features/activity/components/activity-list";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";

export function ActivityScreen() {
  const { profile } = useAppSession();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Invoice and request history across this profile. Checkout attempts and payment problems are
        in Payments.
      </p>
      <ActivityList profileId={profile.profileId} />
    </div>
  );
}
