"use client";

import { Button, type ButtonSize, buttonClasses, EmptyState, SearchField } from "@forwend/ui-web";
import { Plus, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useListClientsInfiniteQuery } from "@/features/clients/api/clients-api";
import { CLIENTS_COPY as COPY } from "@/features/clients/constants/clients-copy";
import { countryName } from "@/features/clients/lib/clients";
import type { Client } from "@/features/clients/types/clients";
import { DataTable, DataTableSkeleton } from "@/shared/components/data-table";
import { InitialsAvatar } from "@/shared/components/initials-avatar";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { LoadError } from "@/shared/components/load-error";
import { NoMatch } from "@/shared/components/no-match";
import { SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { APP_ROUTES } from "@/shared/config/routes";
import { useListSearch } from "@/shared/hooks/use-list-filters";

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

// R-86, R-177: one page at a time, and the search goes to the API, kept in ?q.
export function ClientsTable({ profileId }: ClientsTableProps) {
  const search = useListSearch();
  const list = useListClientsInfiniteQuery({ profileId, q: search.apiQuery });
  const data = list.currentData ?? (list.isFetching ? list.data : undefined);
  const stale = !list.currentData && Boolean(data);
  const rows = data?.pages.flatMap((page) => page.items) ?? [];
  const noClients = !search.apiQuery && list.currentData && rows.length === 0;

  return (
    <section
      aria-labelledby="clients-title"
      aria-busy={(!list.currentData && !list.isError) || undefined}
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
              value={search.search}
              onValueChange={search.setSearch}
              placeholder={COPY.searchPlaceholder}
              className="flex-1"
            />
          }
          actions={<AddClientLink className="max-lg:hidden" />}
        />
      ) : null}

      {list.isError && !data ? (
        <LoadError
          page
          message={COPY.failed}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : !data ? (
        <DataTableSkeleton count={SKELETON_ROWS} className="fw-panel" />
      ) : noClients ? (
        <EmptyState
          page
          icon={Users}
          title={COPY.empty}
          description={COPY.emptyText}
          action={<AddClientLink />}
        />
      ) : rows.length === 0 ? (
        <NoMatch page onClear={search.clear} clearLabel={COPY.clearSearch} />
      ) : (
        <div
          className={
            stale ? "opacity-60 transition-opacity duration-[var(--fw-duration-fast)]" : undefined
          }
        >
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
            footer={
              list.hasNextPage ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  {COPY.loadMore}
                </Button>
              ) : undefined
            }
          />
        </div>
      )}
      {list.error && data ? (
        <LoadError
          inline
          message={COPY.updateFailed}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : null}
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
