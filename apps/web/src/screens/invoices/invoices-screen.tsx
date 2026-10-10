"use client";

import { useGetBalancesQuery } from "@/features/balances/balances-api";
import { INVOICES_COPY } from "@/features/invoices/invoices-copy";
import { InvoicesTable } from "@/features/invoices/invoices-table";
import { useAppSession } from "@/features/profiles/app-session";
import { PROFILE_KINDS } from "@/features/profiles/profile";
import { LIVE_QUERY } from "@/shared/config/refresh";

// The balances' tokens give each invoice's token its symbol and decimals.
export function InvoicesScreen() {
  const { profile } = useAppSession();
  const balances = useGetBalancesQuery(profile.profileId, LIVE_QUERY);
  if (profile.kind === PROFILE_KINDS.personal) {
    return <p className="text-muted">{INVOICES_COPY.personal}</p>;
  }
  return (
    <InvoicesTable
      key={profile.profileId}
      profileId={profile.profileId}
      tokens={balances.currentData?.tokens ?? null}
    />
  );
}
