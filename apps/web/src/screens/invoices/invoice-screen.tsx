"use client";

import { useGetBalancesQuery } from "@/features/balances/api/balances-api";
import { InvoiceDetail } from "@/features/invoices/components/invoice-detail";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { LIVE_QUERY } from "@/shared/config/refresh";

export function InvoiceScreen({ invoiceId }: { invoiceId: string }) {
  const { profile } = useAppSession();
  const balances = useGetBalancesQuery(profile.profileId, LIVE_QUERY);
  return (
    <InvoiceDetail
      invoiceId={invoiceId}
      profileId={profile.profileId}
      tokens={balances.currentData?.tokens ?? null}
      request={profile.kind === PROFILE_KINDS.personal}
    />
  );
}
