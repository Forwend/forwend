"use client";

import { useAppSession } from "@/features/profiles/app-session";
import { TRANSACTIONS_COPY } from "@/features/transactions/transactions-copy";
import { TransactionsTable } from "@/features/transactions/transactions-table";

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
