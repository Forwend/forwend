"use client";

import { Button, Skeleton } from "@forwend/ui-web";
import { useGetBalancesQuery } from "@/features/balances/balances-api";
import { NewInvoiceForm } from "@/features/invoices/components/new-invoice-form";
import { INVOICES_COPY, NEW_INVOICE_COPY } from "@/features/invoices/invoices-copy";
import { useAppSession } from "@/features/profiles/app-session";
import { PROFILE_KINDS } from "@/features/profiles/profile";
import { LIVE_QUERY } from "@/shared/config/refresh";

// The enabled tokens (from the balances) are the networks and tokens an invoice can ask for.
export function NewInvoiceScreen() {
  const { profile } = useAppSession();
  const balances = useGetBalancesQuery(profile.profileId, LIVE_QUERY);
  const tokens = balances.currentData?.tokens;
  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
        <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
          {NEW_INVOICE_COPY.title}
        </h1>
        <p className="text-muted">{NEW_INVOICE_COPY.intro}</p>
      </div>
      {profile.kind === PROFILE_KINDS.personal ? (
        <p className="text-muted">{INVOICES_COPY.personal}</p>
      ) : !tokens && balances.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {NEW_INVOICE_COPY.tokensFailed}
          <Button size="sm" variant="secondary" onClick={() => void balances.refetch()}>
            {INVOICES_COPY.retry}
          </Button>
        </div>
      ) : !tokens ? (
        <Skeleton className="h-96" />
      ) : tokens.length === 0 ? (
        <p className="text-muted">{NEW_INVOICE_COPY.noTokens}</p>
      ) : (
        <NewInvoiceForm key={profile.profileId} profileId={profile.profileId} tokens={tokens} />
      )}
    </div>
  );
}
