"use client";
import { Button } from "@forwend/ui-web";

import { InvoicesTable } from "@/features/invoices/components/invoices-table";
import { useGetProfileTokensQuery } from "@/features/profiles/api/profiles-api";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";

// The enabled tokens give each invoice's token its symbol and decimals; every role reads them, not only the balances
// (D-93). A personal profile's invoices are requests (D-52).
export function InvoicesScreen() {
  const { profile, openRequest } = useAppSession();
  const tokens = useGetProfileTokensQuery(profile.profileId);
  return (
    <div className="flex flex-col gap-4">
      {tokens.isError ? (
        <p role="alert" className="text-sm text-danger">
          Token details could not load. Amounts use base units until refreshed.{" "}
          <Button variant="link" size="sm" onClick={() => void tokens.refetch()}>
            Try again
          </Button>
        </p>
      ) : null}
      <InvoicesTable
        key={profile.profileId}
        profileId={profile.profileId}
        tokens={tokens.currentData ?? (tokens.isError ? [] : null)}
        onRequest={profile.kind === PROFILE_KINDS.personal ? openRequest : undefined}
      />
    </div>
  );
}
