"use client";

import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { TransactionsTable } from "@/features/transactions/components/transactions-table";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";

export function TransactionsScreen() {
  const { profile } = useAppSession();
  return (
    <TransactionsTable
      profileId={profile.profileId}
      title={TRANSACTIONS_COPY.transactions}
      pageHeading
    />
  );
}
