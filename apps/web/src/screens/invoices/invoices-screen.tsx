"use client";

import { useGetBalancesQuery } from "@/features/balances/balances-api";
import { InvoicesTable } from "@/features/invoices/components/invoices-table";
import { useAppSession } from "@/features/profiles/app-session";
import { PROFILE_KINDS } from "@/features/profiles/profile";
import { LIVE_QUERY } from "@/shared/config/refresh";

// The balances' tokens give each invoice's token its symbol and decimals. A personal profile's invoices are its
// requests (D-52).
export function InvoicesScreen() {
  const { profile, openRequest } = useAppSession();
  const balances = useGetBalancesQuery(profile.profileId, LIVE_QUERY);
  return (
    <InvoicesTable
      key={profile.profileId}
      profileId={profile.profileId}
      tokens={balances.currentData?.tokens ?? null}
      onRequest={profile.kind === PROFILE_KINDS.personal ? openRequest : undefined}
    />
  );
}
