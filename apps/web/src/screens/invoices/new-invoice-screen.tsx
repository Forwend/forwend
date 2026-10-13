"use client";

import { Button, Skeleton } from "@forwend/ui-web";
import { useRouter } from "next/navigation";
import { useGetBalancesQuery } from "@/features/balances/api/balances-api";
import { NewInvoiceForm } from "@/features/invoices/components/new-invoice-form";
import {
  INVOICES_COPY,
  NEW_INVOICE_COPY,
  NEW_REQUEST_COPY,
} from "@/features/invoices/constants/invoices-copy";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";

// The enabled tokens (from the balances) are the networks and tokens an invoice can ask for. A personal profile makes
// a request here instead (D-52, R-71), then lands on it with its pay link.
export function NewInvoiceScreen() {
  const { profile } = useAppSession();
  const router = useRouter();
  const balances = useGetBalancesQuery(profile.profileId, LIVE_QUERY);
  const tokens = balances.currentData?.tokens;
  const request = profile.kind === PROFILE_KINDS.personal;
  const COPY = request ? NEW_REQUEST_COPY : NEW_INVOICE_COPY;
  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
        <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">{COPY.title}</h1>
        <p className="text-muted">{COPY.intro}</p>
      </div>
      {!tokens && balances.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {COPY.tokensFailed}
          <Button size="sm" variant="secondary" onClick={() => void balances.refetch()}>
            {INVOICES_COPY.retry}
          </Button>
        </div>
      ) : !tokens ? (
        <Skeleton className="h-96" />
      ) : tokens.length === 0 ? (
        <p className="text-muted">{COPY.noTokens}</p>
      ) : (
        <NewInvoiceForm
          key={profile.profileId}
          profileId={profile.profileId}
          tokens={tokens}
          request={
            request
              ? {
                  senderName: profile.name ?? "",
                  onCreated: (invoice) =>
                    router.push(`${APP_ROUTES.invoices}/${invoice.invoiceId}`),
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
