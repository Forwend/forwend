"use client";

import {
  Button,
  type ButtonSize,
  buttonClasses,
  EmptyState,
  ROW_INTERACTIVE_CLASSES,
  SearchField,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
} from "@forwend/ui-web";
import { Plus, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useListClientsQuery } from "@/features/clients/api/clients-api";
import { CLIENTS_COPY as COPY } from "@/features/clients/constants/clients-copy";
import { matchesClient } from "@/features/clients/lib/clients";
import type { Client } from "@/features/clients/types/clients";
import { InitialsAvatar } from "@/shared/components/initials-avatar";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { NoMatch } from "@/shared/components/no-match";
import { RowsSkeleton, SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { APP_ROUTES } from "@/shared/config/routes";

const COUNTRY = new Intl.DisplayNames(undefined, { type: "region" });
const countryName = (code: string | null) => (code ? (COUNTRY.of(code) ?? code) : null);
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
      {list.currentData && !noClients ? (
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
        <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {COPY.failed}
          <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
            {COPY.retry}
          </Button>
        </div>
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
        <div className="fw-panel overflow-hidden">
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className={TABLE_HEAD_CLASSES}>
                  <th scope="col" className="w-[34%]">
                    {COPY.columns.client}
                  </th>
                  <th scope="col">{COPY.columns.email}</th>
                  <th scope="col">{COPY.columns.country}</th>
                  <th scope="col">{COPY.columns.taxId}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((client) => (
                  <tr
                    key={client.clientId}
                    className={`relative transition-colors duration-[var(--fw-duration-fast)] ${TABLE_ROW_CLASSES} ${ROW_INTERACTIVE_CLASSES}`}
                  >
                    <td className="max-w-72">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <InitialsAvatar name={client.name} small fallback={<ClientIcon />} />
                        <Link
                          href={clientHref(client)}
                          title={client.name}
                          className="truncate font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                        >
                          {client.name}
                        </Link>
                      </span>
                    </td>
                    <Cell value={client.email} />
                    <Cell value={countryName(client.country)} />
                    <Cell value={client.taxId} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line xl:hidden">
            {rows.map((client) => (
              <li key={client.clientId}>
                <Link
                  href={clientHref(client)}
                  className={`flex min-h-16 items-center gap-3 px-4 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:px-5 ${ROW_INTERACTIVE_CLASSES}`}
                >
                  <InitialsAvatar name={client.name} fallback={<ClientIcon />} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{client.name}</span>
                    {client.email || client.taxId ? (
                      <span className="block truncate text-xs text-muted">
                        {[client.email, client.taxId].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  {client.country ? (
                    <span className="max-w-[40%] truncate text-right text-sm text-muted">
                      {countryName(client.country)}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// A name with no letters (only digits, say) has no initials.
function ClientIcon() {
  return <UserRound className="size-[var(--fw-icon-sm)]" />;
}

function Cell({ value }: { value: string | null }) {
  return (
    <td title={value ?? undefined} className="max-w-56 truncate text-muted">
      {value ?? <span className="text-subtle">{COPY.none}</span>}
    </td>
  );
}
