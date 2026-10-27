"use client";

import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { TransactionsTable } from "@/features/transactions/components/transactions-table";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";

export function TransactionsScreen() {
  const { profile } = useAppSession();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Transactions in the shared profile wallet, across all stores. Use Payments for store records
        and settlement details.
      </p>
      <TransactionsTable
        profileId={profile.profileId}
        title={TRANSACTIONS_COPY.transactions}
        pageHeading
      />
    </div>
  );
}
