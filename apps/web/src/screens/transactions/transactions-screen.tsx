"use client";

import { useSearchParams } from "next/navigation";
import { useAppSession } from "@/features/profiles/app-session";
import { TRANSACTIONS_COPY } from "@/features/transactions/transactions-copy";
import { TransactionsTable } from "@/features/transactions/transactions-table";

// A new search (from ⌘K or a notification) starts a new table.
export function TransactionsScreen() {
  const { profile } = useAppSession();
  const search = useSearchParams().get("search") ?? "";
  return (
    <TransactionsTable
      key={search}
      profileId={profile.profileId}
      title={TRANSACTIONS_COPY.transactions}
      pageHeading
      initialSearch={search}
    />
  );
}
