"use client";

import { Button, buttonClasses, Skeleton } from "@forwend/ui-web";
import Link from "next/link";
import { useState } from "react";
import { useListClientsQuery } from "@/features/clients/api/clients-api";
import { ClientActions } from "@/features/clients/components/client-actions";
import { ClientForm } from "@/features/clients/components/client-form";
import { CLIENTS_COPY as COPY } from "@/features/clients/constants/clients-copy";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { APP_ROUTES } from "@/shared/config/routes";

export interface ClientScreenProps {
  /** The client to edit; a new client without one. */
  clientId?: string;
}

// A form page under Clients, laid out like New invoice: field groups in panels, with the client's More actions menu at
// the page's top right, as on an invoice. The client comes from the list the page above loaded (one request for all).
export function ClientScreen({ clientId }: ClientScreenProps) {
  const { profile } = useAppSession();
  const list = useListClientsQuery(profile.profileId, { skip: !clientId });
  // Once deleted, the page waits to leave instead of saying the client is gone.
  const [deleted, setDeleted] = useState(false);
  const client = list.currentData?.find((c) => c.clientId === clientId);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
          <h1 className="text-2xl font-semibold tracking-tight break-words text-ink lg:sr-only">
            {clientId ? (client?.name ?? COPY.editTitle) : COPY.newTitle}
          </h1>
          <p className="text-muted">{COPY.intro}</p>
        </div>
        {client && !deleted ? (
          <ClientActions
            profileId={profile.profileId}
            client={client}
            onDeleted={() => setDeleted(true)}
          />
        ) : null}
      </header>
      {!clientId ? (
        <ClientForm key={profile.profileId} profileId={profile.profileId} />
      ) : list.isError && !list.currentData ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {COPY.failed}
          <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
            {COPY.retry}
          </Button>
        </div>
      ) : !list.currentData || deleted ? (
        <Skeleton className="h-96" />
      ) : client ? (
        // A new form per client, so it never keeps another client's values.
        <ClientForm key={client.clientId} profileId={profile.profileId} client={client} />
      ) : (
        <div className="flex flex-col items-start gap-3 text-sm text-muted">
          {COPY.gone}
          <Link
            href={APP_ROUTES.clients}
            className={buttonClasses({ size: "sm", variant: "secondary" })}
          >
            {COPY.backToList}
          </Link>
        </div>
      )}
    </div>
  );
}
