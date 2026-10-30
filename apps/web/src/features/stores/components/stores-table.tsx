"use client";

import { type ButtonSize, buttonClasses } from "@forwend/ui-web";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { STORES_COPY as COPY } from "@/features/stores/constants/stores-copy";
import type { Store } from "@/features/stores/types/stores";
import { DataTable, DataTableSkeleton } from "@/shared/components/data-table";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { LoadError } from "@/shared/components/load-error";
import { APP_ROUTES } from "@/shared/config/routes";

const storeHref = (store: Store) => `${APP_ROUTES.stores}/${store.storeId}`;

function AddStoreLink({ className = "", size = "md" }: { className?: string; size?: ButtonSize }) {
  return (
    <Link href={APP_ROUTES.newStore} className={`${buttonClasses({ size })} ${className}`}>
      <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />
      {COPY.add}
    </Link>
  );
}

export interface StoresTableProps {
  profileId: string;
  /** When each store's checkout closes, by its seconds: New invoice's labels, which the screen passes in. */
  closeLabel: (seconds: number) => string;
  /** Whether the user's role makes stores (D-93); a Finance member only reads them. */
  canAdd: boolean;
}

// R-134. A merchant profile always has its first store, so the list is never empty.
export function StoresTable({ profileId, closeLabel, canAdd }: StoresTableProps) {
  const list = useListStoresQuery(profileId);
  const stores = list.currentData ?? [];
  const origins = (store: Store) =>
    store.allowedOrigins.length === 0
      ? COPY.noOrigins
      : store.allowedOrigins.length === 1
        ? store.allowedOrigins[0]
        : COPY.originCount(store.allowedOrigins.length);

  return (
    <section
      aria-labelledby="stores-title"
      aria-busy={!list.currentData && !list.isError}
      className="flex flex-col gap-4"
    >
      {/* The header's breadcrumb names the page on desktop, so the heading and its action show only below that. */}
      <div className="flex items-center justify-between gap-3 lg:contents">
        <h1 id="stores-title" className="text-2xl font-semibold tracking-tight text-ink lg:sr-only">
          {COPY.title}
        </h1>
        {canAdd ? <AddStoreLink size="sm" className="lg:hidden" /> : null}
      </div>
      <ListToolbar
        search={<p className="flex-1 text-sm text-muted">{COPY.intro}</p>}
        actions={canAdd ? <AddStoreLink className="max-lg:hidden" /> : null}
      />

      {list.isError && !list.currentData ? (
        <LoadError
          page
          message={COPY.failed}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : !list.currentData ? (
        <DataTableSkeleton count={2} className="fw-panel" />
      ) : (
        <DataTable
          label={COPY.title}
          rows={stores}
          rowKey={(store) => store.storeId}
          rowHref={storeHref}
          rowLabel={(store) => store.name}
          columns={[
            {
              key: "store",
              header: COPY.columns.store,
              className: "w-[30%]",
              cell: (store) => <span className="font-medium text-ink">{store.name}</span>,
            },
            {
              key: "closes",
              header: COPY.columns.closes,
              cell: (store) => (
                <span className="text-muted">{closeLabel(store.defaultExpiresIn)}</span>
              ),
            },
            {
              key: "origins",
              header: COPY.columns.origins,
              from: "md",
              cell: (store) => (
                <span title={store.allowedOrigins.join(", ")} className="text-muted">
                  {origins(store)}
                </span>
              ),
            },
            {
              key: "project",
              header: COPY.columns.projectId,
              from: "xl",
              cell: (store) => (
                <span title={store.storeId} className="font-mono text-xs text-muted">
                  {store.storeId}
                </span>
              ),
            },
          ]}
          phone={(store) => ({
            title: store.name,
            detail: origins(store),
            value: <span className="text-muted">{closeLabel(store.defaultExpiresIn)}</span>,
          })}
        />
      )}
    </section>
  );
}
