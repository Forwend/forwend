"use client";

import { useGetBalancesQuery } from "@/features/balances/api/balances-api";
import { InvoicesTable } from "@/features/invoices/components/invoices-table";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { LIVE_QUERY } from "@/shared/config/refresh";

// The balances' tokens give each invoice's token its symbol and decimals; a personal profile's are requests (D-52).
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
