"use client";

import { Button, buttonClasses, EmptyState, Skeleton } from "@forwend/ui-web";
import { IdCard } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useListClientsQuery } from "@/features/clients/api/clients-api";
import { useGetProfileInvoiceQuery } from "@/features/invoices/api/invoices-api";
import { NewInvoiceForm } from "@/features/invoices/components/new-invoice-form";
import { RESTART_PARAMS } from "@/features/invoices/constants/invoices";
import {
  INVOICES_COPY,
  NEW_INVOICE_COPY,
  NEW_REQUEST_COPY,
} from "@/features/invoices/constants/invoices-copy";
import { invoiceNumber, restartFrom, tokensOn } from "@/features/invoices/lib/invoices";
import type { Invoice } from "@/features/invoices/types/invoices";
import {
  useGetBillingDetailsQuery,
  useGetProfileTokensQuery,
} from "@/features/profiles/api/profiles-api";
import { BILLING_THEN, PERMISSIONS, PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can } from "@/features/profiles/lib/profile";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { APP_ROUTES } from "@/shared/config/routes";

// A personal profile makes a request here (D-52, R-71). ?from=<id> fills the form from that owned invoice (R-91,
// R-77), read through the cache; nothing comes from the URL but the id.
export function NewInvoiceScreen() {
  const { profile } = useAppSession();
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get(RESTART_PARAMS.from);
  const owned = useGetProfileInvoiceQuery(
    { profileId: profile.profileId, invoiceId: from ?? "" },
    { skip: !from },
  );
  // Another profile's invoice, or one that failed to load, starts an empty form.
  // currentData: a 404 for this id must not leave an earlier invoice's values behind.
  const start =
    from && owned.currentData
      ? restartFrom(
          owned.currentData,
          owned.currentData.client,
          params.has(RESTART_PARAMS.rest),
          owned.currentData.reminders,
        )
      : undefined;
  const clientId = params.get(RESTART_PARAMS.client);
  // R-129: ?revise=1 replaces that invoice once this one is created.
  const replaced = params.has(RESTART_PARAMS.revise) ? owned.currentData : undefined;
  // R-136: only the tokens the profile has on, from the enabled tokens every role reads (D-93).
  const switches = useGetProfileTokensQuery(profile.profileId);
  const all = switches.currentData;
  const tokens = all
    ? tokensOn(
        all,
        all.filter((t) => !t.on),
      )
    : undefined;
  const request = profile.kind === PROFILE_KINDS.personal;
  // R-92. If the billing details can't be read, or the role can't (D-93), the form shows and the API still checks.
  const readsBilling = !request && can(profile, PERMISSIONS.billingRead);
  const billing = useGetBillingDetailsQuery(profile.profileId, { skip: !readsBilling });
  const billingNeeded = readsBilling && billing.currentData === null;
  const loadingBilling = readsBilling && billing.currentData === undefined && !billing.isError;
  // A request has no client. Without the list the form still works: the picker just doesn't show.
  const clients = useListClientsQuery(profile.profileId, {
    skip: request || !can(profile, PERMISSIONS.clientsRead),
  });
  // An unknown client id, or a list that failed, starts an empty client.
  const startClient = clientId
    ? clients.currentData?.find((c) => c.clientId === clientId)
    : undefined;
  const loadingStart =
    (Boolean(from) && owned.isLoading) || (Boolean(clientId) && clients.isLoading);
  // Store defaults and acceptance must be known before composing a merchant invoice.
  const merchant = profile.kind === PROFILE_KINDS.merchant;
  const stores = useListStoresQuery(profile.profileId, { skip: !merchant });
  const loadingStores = merchant && stores.currentData === undefined && !stores.isError;
  const COPY = request ? NEW_REQUEST_COPY : NEW_INVOICE_COPY;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
        <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">{COPY.title}</h1>
        <p className="text-muted">{COPY.intro}</p>
      </div>
      {!tokens && switches.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {COPY.tokensFailed}
          <Button size="sm" variant="secondary" onClick={() => void switches.refetch()}>
            {INVOICES_COPY.retry}
          </Button>
        </div>
      ) : replaced === undefined && params.has(RESTART_PARAMS.revise) && owned.isError ? (
        // Without the invoice to replace, a form would make an extra invoice and leave that one open.
        <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {INVOICES_COPY.revise.failed}
          <Button size="sm" variant="secondary" onClick={() => void owned.refetch()}>
            {INVOICES_COPY.revise.retry}
          </Button>
        </div>
      ) : merchant && stores.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          We could not load stores. Choose a store after trying again.
          <Button size="sm" variant="secondary" onClick={() => void stores.refetch()}>
            Try again
          </Button>
        </div>
      ) : merchant && stores.currentData?.length === 0 ? (
        <p role="alert" className="text-sm text-danger">
          No store is available. Ask the account owner to check your store access.
        </p>
      ) : readsBilling && billing.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          We could not load billing details.
          <Button size="sm" variant="secondary" onClick={() => void billing.refetch()}>
            Try again
          </Button>
        </div>
      ) : !tokens || loadingStart || loadingBilling || loadingStores ? (
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
        <>
          {replaced ? <ReviseNotice invoice={replaced} /> : null}
          <NewInvoiceForm
            key={`${profile.profileId}:${from ?? ""}:${clientId ?? ""}`}
            profileId={profile.profileId}
            tokens={tokens}
            start={start}
            startClient={startClient}
            clients={clients.currentData}
            stores={stores.currentData}
            replaces={
              replaced
                ? { invoiceId: replaced.invoiceId, number: invoiceNumber(replaced.number) }
                : undefined
            }
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
        </>
      )}
    </div>
  );
}

const TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** R-129: what a Revise cancels, and whether the client may already have its pay link. */
function ReviseNotice({ invoice }: { invoice: Invoice }) {
  const COPY = INVOICES_COPY.revise;
  const number = invoiceNumber(invoice.number);
  const sent = invoice.sends?.findLast((s) => s.sentAt)?.sentAt;
  const views = invoice.views;
  return (
    <section
      aria-labelledby="revise-notice"
      className="flex flex-col gap-1.5 rounded-lg border border-line bg-warning-soft px-4 py-3 text-sm text-ink sm:px-5"
    >
      <h2 id="revise-notice" className="font-semibold">
        {COPY.title(number)}
      </h2>
      <p>{COPY.body(number)}</p>
      {sent ? <p>{COPY.sent(number, TIME.format(new Date(sent)))}</p> : null}
      {views?.lastAt ? (
        <p>{COPY.opened(views.count, TIME.format(new Date(views.lastAt)))}</p>
      ) : null}
      {sent || views?.lastAt ? <p>{COPY.held}</p> : null}
    </section>
  );
}
