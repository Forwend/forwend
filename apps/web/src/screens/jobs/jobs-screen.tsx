"use client";

import { JobsTable } from "@/features/jobs/components/jobs-table";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";

export function JobsScreen() {
  const { profile } = useAppSession();
  return <JobsTable key={profile.profileId} profileId={profile.profileId} />;
}
