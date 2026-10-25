"use client";

import {
  Button,
  type ButtonSize,
  buttonClasses,
  ROW_INTERACTIVE_CLASSES,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
} from "@forwend/ui-web";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { STORES_COPY as COPY } from "@/features/stores/constants/stores-copy";
import type { Store } from "@/features/stores/types/stores";
import { ListToolbar } from "@/shared/components/list-toolbar";
import { RowsSkeleton } from "@/shared/components/rows-skeleton";
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
        <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {COPY.failed}
          <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
            {COPY.retry}
          </Button>
        </div>
      ) : !list.currentData ? (
        <RowsSkeleton count={2} className="fw-panel" />
      ) : (
        <div className="fw-panel overflow-hidden">
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className={TABLE_HEAD_CLASSES}>
                  <th scope="col" className="w-[30%]">
                    {COPY.columns.store}
                  </th>
                  <th scope="col">{COPY.columns.projectId}</th>
                  <th scope="col">{COPY.columns.closes}</th>
                  <th scope="col">{COPY.columns.origins}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {stores.map((store) => (
                  <tr
                    key={store.storeId}
                    className={`relative transition-colors duration-[var(--fw-duration-fast)] ${TABLE_ROW_CLASSES} ${ROW_INTERACTIVE_CLASSES}`}
                  >
                    <td className="max-w-72">
                      <Link
                        href={storeHref(store)}
                        title={store.name}
                        className="block truncate font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                      >
                        {store.name}
                      </Link>
                    </td>
                    <td className="max-w-56 truncate font-mono text-muted" title={store.storeId}>
                      {store.storeId}
                    </td>
                    <td className="text-muted">{closeLabel(store.defaultExpiresIn)}</td>
                    <td
                      className="max-w-56 truncate text-muted"
                      title={store.allowedOrigins.join(", ")}
                    >
                      {origins(store)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line xl:hidden">
            {stores.map((store) => (
              <li key={store.storeId}>
                <Link
                  href={storeHref(store)}
                  className={`flex min-h-16 items-center gap-3 px-4 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:px-5 ${ROW_INTERACTIVE_CLASSES}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{store.name}</span>
                    <span className="block truncate text-xs text-muted">{origins(store)}</span>
                  </span>
                  <span className="max-w-[40%] truncate text-right text-sm text-muted">
                    {closeLabel(store.defaultExpiresIn)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
