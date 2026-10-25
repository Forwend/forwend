"use client";

import { InvoicesTable } from "@/features/invoices/components/invoices-table";
import { useGetProfileTokensQuery } from "@/features/profiles/api/profiles-api";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";

// The enabled tokens give each invoice's token its symbol and decimals; every role reads them, not only the balances
// (D-93). A personal profile's invoices are requests (D-52).
export function InvoicesScreen() {
  const { profile, openRequest } = useAppSession();
  const tokens = useGetProfileTokensQuery(profile.profileId);
  return (
    <InvoicesTable
      key={profile.profileId}
      profileId={profile.profileId}
      tokens={tokens.currentData ?? null}
      onRequest={profile.kind === PROFILE_KINDS.personal ? openRequest : undefined}
    />
  );
}
