"use client";

import { type ButtonSize, buttonClasses, EmptyState, SearchField } from "@forwend/ui-web";
import { Plus, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useListClientsQuery } from "@/features/clients/api/clients-api";
import { CLIENTS_COPY as COPY } from "@/features/clients/constants/clients-copy";
import { countryName, matchesClient } from "@/features/clients/lib/clients";
import type { Client } from "@/features/clients/types/clients";
import { DataTable } from "@/shared/components/data-table";
import { InitialsAvatar } from "@/shared/components/initials-avatar";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { LoadError } from "@/shared/components/load-error";
import { NoMatch } from "@/shared/components/no-match";
import { RowsSkeleton, SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { APP_ROUTES } from "@/shared/config/routes";

const clientHref = (client: Client) => `${APP_ROUTES.clients}/${client.clientId}`;

function AddClientLink({ className = "", size = "md" }: { className?: string; size?: ButtonSize }) {
  return (
    <Link href={APP_ROUTES.newClient} className={`${buttonClasses({ size })} ${className}`}>
      <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
      {COPY.add}
    </Link>
  );
}

export interface ClientsTableProps {
  profileId: string;
}

// R-86. The list comes whole (at most 1000), so the search filters here.
export function ClientsTable({ profileId }: ClientsTableProps) {
  const list = useListClientsQuery(profileId);
  const [search, setSearch] = useState("");
  const clients = list.currentData ?? [];
  const rows = clients.filter((client) => matchesClient(client, search));
  const noClients = list.currentData && clients.length === 0;

  return (
    <section
      aria-labelledby="clients-title"
      aria-busy={!list.currentData && !list.isError}
      className="flex flex-col gap-4"
    >
      {/* The header's breadcrumb names the page on desktop, so the heading and its action show only below that. */}
      <div className="flex items-center justify-between gap-3 lg:contents">
        <h1
          id="clients-title"
          className="text-2xl font-semibold tracking-tight text-ink lg:sr-only"
        >
          {COPY.title}
        </h1>
        {/* An empty list offers it in its own block instead. */}
        {noClients ? null : <AddClientLink size="sm" className="lg:hidden" />}
      </div>
      {!noClients ? (
        <ListToolbar
          search={
            <SearchField
              label={COPY.search}
              value={search}
              onValueChange={setSearch}
              placeholder={COPY.searchPlaceholder}
              className="flex-1"
            />
          }
          actions={<AddClientLink className="max-lg:hidden" />}
        />
      ) : null}

      {list.isError && !list.currentData ? (
        <LoadError
          message={COPY.failed}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : !list.currentData ? (
        <RowsSkeleton count={SKELETON_ROWS} className="fw-panel" />
      ) : noClients ? (
        <EmptyState
          icon={Users}
          title={COPY.empty}
          description={COPY.emptyText}
          action={<AddClientLink />}
        />
      ) : rows.length === 0 ? (
        <NoMatch onClear={() => setSearch("")} clearLabel={COPY.clearSearch} />
      ) : (
        <DataTable
          label={COPY.title}
          rows={rows}
          rowKey={(client) => client.clientId}
          rowHref={clientHref}
          rowLabel={(client) => client.name}
          columns={[
            {
              key: "client",
              header: COPY.columns.client,
              className: "w-[34%]",
              cell: (client) => (
                <span className="flex min-w-0 items-center gap-2.5">
                  <InitialsAvatar name={client.name} small fallback={<ClientIcon />} />
                  <span className="truncate font-medium text-ink">{client.name}</span>
                </span>
              ),
            },
            {
              key: "email",
              header: COPY.columns.email,
              cell: (client) => <Value value={client.email} />,
            },
            {
              key: "country",
              header: COPY.columns.country,
              from: "md",
              cell: (client) => <Value value={countryName(client.country)} />,
            },
            {
              key: "tax",
              header: COPY.columns.taxId,
              from: "lg",
              cell: (client) => <Value value={client.taxId} />,
            },
          ]}
          phone={(client) => ({
            leading: <InitialsAvatar name={client.name} fallback={<ClientIcon />} />,
            title: client.name,
            detail: [client.email, client.taxId].filter(Boolean).join(" · ") || undefined,
            value: client.country ? (
              <span className="text-muted">{countryName(client.country)}</span>
            ) : undefined,
          })}
        />
      )}
    </section>
  );
}

// A name with no letters (only digits, say) has no initials.
function ClientIcon() {
  return <UserRound className="size-[var(--fw-icon-sm)]" />;
}

function Value({ value }: { value: string | null }) {
  return value ? (
    <span title={value} className="text-muted">
      {value}
    </span>
  ) : (
    <span className="text-subtle">{COPY.none}</span>
  );
}
