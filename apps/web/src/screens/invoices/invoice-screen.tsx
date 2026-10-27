"use client";

import { InvoiceDetail } from "@/features/invoices/components/invoice-detail";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";

export interface InvoiceScreenProps {
  invoiceId: string;
}

export function InvoiceScreen({ invoiceId }: InvoiceScreenProps) {
  const { profile } = useAppSession();
  return (
    <InvoiceDetail
      invoiceId={invoiceId}
      profileId={profile.profileId}
      tokens={[]}
      request={profile.kind === PROFILE_KINDS.personal}
    />
  );
}
