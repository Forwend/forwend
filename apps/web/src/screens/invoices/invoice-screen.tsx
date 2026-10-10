"use client";

import { useGetBalancesQuery } from "@/features/balances/balances-api";
import { InvoiceDetail } from "@/features/invoices/invoice-detail";
import { useAppSession } from "@/features/profiles/app-session";
import { LIVE_QUERY } from "@/shared/config/refresh";

export function InvoiceScreen({ invoiceId }: { invoiceId: string }) {
  const { profile } = useAppSession();
  const balances = useGetBalancesQuery(profile.profileId, LIVE_QUERY);
  return (
    <InvoiceDetail
      invoiceId={invoiceId}
      profileId={profile.profileId}
      tokens={balances.currentData?.tokens ?? null}
    />
  );
}
