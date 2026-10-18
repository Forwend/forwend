"use client";

import { Button, buttonClasses, EmptyState, Skeleton } from "@forwend/ui-web";
import { IdCard } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useGetBalancesQuery } from "@/features/balances/api/balances-api";
import { useListClientsQuery } from "@/features/clients/api/clients-api";
import {
  useGetInvoiceQuery,
  useGetProfileInvoiceQuery,
} from "@/features/invoices/api/invoices-api";
import { NewInvoiceForm } from "@/features/invoices/components/new-invoice-form";
import { RESTART_PARAMS } from "@/features/invoices/constants/invoices";
import {
  INVOICES_COPY,
  NEW_INVOICE_COPY,
  NEW_REQUEST_COPY,
} from "@/features/invoices/constants/invoices-copy";
import { restartFrom } from "@/features/invoices/lib/invoices";
import { useGetBillingDetailsQuery } from "@/features/profiles/api/profiles-api";
import { BILLING_THEN, PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";

// The enabled tokens (from the balances) are the networks and tokens an invoice can ask for. A personal profile makes
// a request here instead (D-52, R-71), then lands on it with its pay link. ?from=<id> fills the form from that invoice
// (Duplicate, R-91, or a closed one's next step, R-77), read from the cache its page filled; the client comes from the
// owner's read, never from the URL.
export function NewInvoiceScreen() {
  const { profile } = useAppSession();
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get(RESTART_PARAMS.from);
  const balances = useGetBalancesQuery(profile.profileId, LIVE_QUERY);
  const source = useGetInvoiceQuery(from ?? "", { skip: !from });
  const owned = useGetProfileInvoiceQuery(
    { profileId: profile.profileId, invoiceId: from ?? "" },
    { skip: !from },
  );
  // Another profile's invoice, or one that failed to load, starts an empty form.
  // currentData: a 404 for this id must not leave an earlier invoice's values behind.
  const start =
    from && source.currentData && owned.currentData
      ? restartFrom(
          source.currentData,
          owned.currentData.client,
          params.has(RESTART_PARAMS.rest),
          owned.currentData.reminders,
        )
      : undefined;
  const loadingStart = Boolean(from) && (source.isLoading || owned.isLoading);
  const tokens = balances.currentData?.tokens;
  const request = profile.kind === PROFILE_KINDS.personal;
  // A business invoice names who bills the client, so a freelancer or merchant adds billing details first (R-92); if
  // they can't be read, the form shows and the API still checks.
  const billing = useGetBillingDetailsQuery(profile.profileId, { skip: request });
  const billingNeeded = !request && billing.currentData === null;
  const loadingBilling = !request && billing.currentData === undefined && !billing.isError;
  // A request has no client. Without the list the form still works: the picker just doesn't show.
  const clients = useListClientsQuery(profile.profileId, { skip: request });
  const COPY = request ? NEW_REQUEST_COPY : NEW_INVOICE_COPY;
  return (
    <div className="flex max-w-2xl flex-col gap-6 xl:max-w-none">
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
      ) : !tokens || loadingStart || loadingBilling ? (
        <Skeleton className="h-96" />
      ) : billingNeeded ? (
        <EmptyState
          icon={IdCard}
          title={NEW_INVOICE_COPY.billingNeeded.title}
          description={NEW_INVOICE_COPY.billingNeeded.text}
          action={
            <Link
              href={`${APP_ROUTES.billingDetails}?${BILLING_THEN.param}=${BILLING_THEN.newInvoice}`}
              className={buttonClasses({ size: "sm" })}
            >
              {NEW_INVOICE_COPY.billingNeeded.action}
            </Link>
          }
        />
      ) : tokens.length === 0 ? (
        <p className="text-muted">{COPY.noTokens}</p>
      ) : (
        <NewInvoiceForm
          key={`${profile.profileId}:${from ?? ""}`}
          profileId={profile.profileId}
          tokens={tokens}
          start={start}
          clients={clients.currentData}
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
