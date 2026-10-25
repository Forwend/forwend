"use client";

import { LinksTable } from "@/features/links/components/links-table";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";

export function LinksScreen() {
  const { profile } = useAppSession();
  return <LinksTable key={profile.profileId} profileId={profile.profileId} />;
}
