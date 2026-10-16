"use client";

import { Button, Skeleton } from "@forwend/ui-web";
import { useState } from "react";
import { useListClientsQuery } from "@/features/clients/api/clients-api";
import { ClientForm } from "@/features/clients/components/client-form";
import { ClientList } from "@/features/clients/components/client-list";
import { CLIENTS_COPY as COPY } from "@/features/clients/constants/clients-copy";
import type { Client } from "@/features/clients/types/clients";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";

const NEW = "new";

// R-86: the profile's saved clients, with one form for a new client or the one being edited.
export function ClientsScreen() {
  const { profile } = useAppSession();
  const clients = useListClientsQuery(profile.profileId);
  const [editing, setEditing] = useState<Client | typeof NEW | null>(null);
  const add = <Button onClick={() => setEditing(NEW)}>{COPY.add}</Button>;
  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        {/* The header's breadcrumb names the page on desktop, so the heading shows only on phones. */}
        <h1 className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">{COPY.title}</h1>
        <p className="text-muted">{COPY.intro}</p>
      </div>
      {editing ? (
        <section aria-labelledby="client-form" className="fw-panel sm:rounded-lg">
          <h2 id="client-form" className="fw-panel-head text-base font-semibold text-ink">
            {editing === NEW ? COPY.addTitle : COPY.edit(editing.name)}
          </h2>
          <div className="p-4 sm:p-5">
            {/* A new form per client and profile, so it never keeps another client's values. */}
            <ClientForm
              key={`${profile.profileId}:${editing === NEW ? NEW : editing.clientId}`}
              profileId={profile.profileId}
              client={editing === NEW ? undefined : editing}
              onDone={() => setEditing(null)}
            />
          </div>
        </section>
      ) : clients.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {COPY.loadFailed}
          <Button size="sm" variant="secondary" onClick={clients.refetch}>
            {COPY.retry}
          </Button>
        </div>
      ) : clients.currentData === undefined ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {clients.currentData.length > 0 ? <div className="self-start">{add}</div> : null}
          <ClientList
            profileId={profile.profileId}
            clients={clients.currentData}
            onEdit={setEditing}
            addAction={add}
          />
        </>
      )}
    </div>
  );
}
