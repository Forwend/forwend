"use client";

import { Button } from "@forwend/ui-web";
import { QrCode } from "lucide-react";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { TransactionsTable } from "@/features/transactions/components/transactions-table";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";

export function TransactionsScreen() {
  const { profile, openReceive } = useAppSession();
  return (
    <TransactionsTable
      profileId={profile.profileId}
      title={TRANSACTIONS_COPY.transactions}
      intro={
        profile.kind === PROFILE_KINDS.personal
          ? TRANSACTIONS_COPY.intro
          : TRANSACTIONS_COPY.introBusiness
      }
      pageHeading
      emptyAction={
        <Button variant="secondary" onClick={openReceive}>
          <QrCode aria-hidden className="size-[var(--fw-icon-sm)]" />
          {BALANCES_COPY.receive}
        </Button>
      }
    />
  );
}
