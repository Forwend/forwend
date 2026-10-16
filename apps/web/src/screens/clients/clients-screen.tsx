"use client";

import { ClientsTable } from "@/features/clients/components/clients-table";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";

export function ClientsScreen() {
  const { profile } = useAppSession();
  return <ClientsTable key={profile.profileId} profileId={profile.profileId} />;
}
