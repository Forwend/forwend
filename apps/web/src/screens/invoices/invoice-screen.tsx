"use client";

import { InvoiceDetail } from "@/features/invoices/components/invoice-detail";
import { useGetProfileTokensQuery } from "@/features/profiles/api/profiles-api";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";

export interface InvoiceScreenProps {
  invoiceId: string;
}

export function InvoiceScreen({ invoiceId }: InvoiceScreenProps) {
  const { profile } = useAppSession();
  // As on Invoices: the enabled tokens, which every role reads (D-93).
  const tokens = useGetProfileTokensQuery(profile.profileId);
  return (
    <InvoiceDetail
      invoiceId={invoiceId}
      profileId={profile.profileId}
      tokens={tokens.currentData ?? null}
      request={profile.kind === PROFILE_KINDS.personal}
    />
  );
}
