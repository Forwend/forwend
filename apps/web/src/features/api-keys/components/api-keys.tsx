"use client";

import {
  Badge,
  cx,
  Dialog,
  EmptyState,
  Skeleton,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
  TONES,
} from "@forwend/ui-web";
import { KeyRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useListKeysQuery } from "@/features/api-keys/api/api-keys-api";
import { KeyActions } from "@/features/api-keys/components/key-actions";
import { KeySecret } from "@/features/api-keys/components/key-secret";
import { NewKeyDialog } from "@/features/api-keys/components/new-key-dialog";
import { API_KEYS_COPY as COPY } from "@/features/api-keys/constants/api-keys-copy";
import type { ApiKey } from "@/features/api-keys/types/api-keys";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { LoadError } from "@/shared/components/load-error";
import { dateTime, shortDate } from "@/shared/lib/dates";

export interface ApiKeysProps {
  profileId: string;
  /** A merchant's keys are each for one of its stores; a freelancer has none. */
  merchant: boolean;
}

// The panel's width decides, not the screen's: below it a row keeps only the name cell, which then lists the rest.
const WIDE = "hidden @3xl:table-cell";
const NARROW = "block text-xs text-muted @3xl:hidden";
const ROW = cx(TABLE_ROW_CLASSES, "max-sm:[&>td:first-child]:pl-4 max-sm:[&>td:last-child]:pr-3");

// R-145: the profile's working keys, newest first, each with its last use and, once rolled, when it stops.
export function ApiKeys({ profileId, merchant }: ApiKeysProps) {
  const keys = useListKeysQuery(profileId);
  const stores = useListStoresQuery(profileId, { skip: !merchant });
  const names = new Map((stores.currentData ?? []).map((s) => [s.storeId, s.name]));
  // A made or rolled key's text, the one time the API answers it. It lives here, not in a row: a roll with no
  // overlap takes the old key's row away. Closing the dialog drops it for good.
  const [secret, setSecret] = useState<string | null>(null);
  const openSecret = useRef<() => void>(null);
  const secretBody = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!secret) return;
    openSecret.current?.();
    // Copy takes the focus: it is what the person came for.
    secretBody.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [secret]);

  // A merchant's rows wait for the store names, so a failed stores load needs the same way out.
  const storesFailed = merchant && stores.isError && !stores.currentData;
  if ((keys.isError && !keys.currentData) || storesFailed) {
    return (
      <LoadError
        message={COPY.loadFailed}
        retrying={keys.isFetching || stores.isFetching}
        onRetry={() => {
          void keys.refetch();
          if (storesFailed) void stores.refetch();
        }}
      />
    );
  }
  const list = keys.currentData;
  const loading = !list || (merchant && !stores.currentData);
  // The list is the profile's mode (R-221), so one badge on the panel says test mode for every row.
  const allTest = !!list?.length && list.every((k) => !k.livemode);
  const storeName = (key: ApiKey) => (key.storeId ? (names.get(key.storeId) ?? key.storeId) : null);
  const scopes = (key: ApiKey) => key.scopes.map((scope) => COPY.scopeLabels[scope]).join(", ");
  return (
    <section aria-labelledby="api-keys" className="fw-panel @container">
      <div className="fw-panel-head justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id="api-keys" className="text-base font-semibold text-ink">
            {COPY.keys}
          </h2>
          {allTest ? <Badge tone={TONES.warning}>{COPY.testMode}</Badge> : null}
        </div>
        {loading ? null : (
          <NewKeyDialog
            profileId={profileId}
            stores={merchant ? (stores.currentData ?? []) : null}
            onMade={setSecret}
          />
        )}
      </div>
      {loading ? (
        <KeysSkeleton />
      ) : list.length === 0 ? (
        <EmptyState compact icon={KeyRound} title={COPY.empty} description={COPY.emptyBody} />
      ) : (
        <table className="w-full table-fixed text-sm">
          <thead className="hidden @3xl:table-header-group">
            <tr className={TABLE_HEAD_CLASSES}>
              <th scope="col" className="w-[24%]">
                {COPY.columns.name}
              </th>
              <th scope="col" className="w-36">
                {COPY.columns.key}
              </th>
              {merchant ? (
                <th scope="col" className="w-[16%]">
                  {COPY.columns.store}
                </th>
              ) : null}
              <th scope="col">{COPY.columns.access}</th>
              <th scope="col" className="w-28">
                {COPY.columns.lastUsed}
              </th>
              <th scope="col" className="w-14">
                <span className="sr-only">{COPY.columns.actions}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((key) => (
              <tr key={key.keyId} className={ROW}>
                <td>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-ink">{key.name}</span>
                    {!allTest && !key.livemode ? (
                      <Badge tone={TONES.warning}>{COPY.testMode}</Badge>
                    ) : null}
                  </span>
                  <span className={NARROW}>
                    <code className="font-mono">{COPY.keyText(key.last4, key.livemode)}</code>
                    {storeName(key) ? ` · ${storeName(key)}` : null}
                    {` · ${scopes(key)}`}
                  </span>
                  <span className={NARROW}>
                    {key.lastUsedAt ? COPY.lastUsed(shortDate(key.lastUsedAt)) : COPY.neverUsed}
                  </span>
                  {/* A roll's overlap can be an hour, so the time matters. */}
                  {key.expiresAt ? (
                    <span className="block text-xs text-warning">
                      {COPY.stops(dateTime(key.expiresAt))}
                    </span>
                  ) : null}
                </td>
                <td className={cx(WIDE, "truncate")}>
                  <code className="font-mono text-xs text-muted">
                    {COPY.keyText(key.last4, key.livemode)}
                  </code>
                </td>
                {merchant ? (
                  <td className={cx(WIDE, "truncate text-ink")}>{storeName(key)}</td>
                ) : null}
                <td className={cx(WIDE, "truncate text-muted")} title={scopes(key)}>
                  {scopes(key)}
                </td>
                <td
                  className={cx(WIDE, "whitespace-nowrap text-muted tabular-nums")}
                  title={key.lastUsedAt ? dateTime(key.lastUsedAt) : undefined}
                >
                  {key.lastUsedAt ? shortDate(key.lastUsedAt) : COPY.never}
                </td>
                <td className="w-14">
                  {/* Not text-right: the row's dialogs live in this cell and would inherit it. */}
                  <div className="flex justify-end">
                    <KeyActions profileId={profileId} apiKey={key} onRolled={setSecret} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Dialog
        triggerLabel={COPY.secretTitle}
        title={COPY.secretTitle}
        onClose={() => setSecret(null)}
        trigger={(open) => {
          openSecret.current = open;
          return null;
        }}
      >
        <div ref={secretBody}>
          {secret ? (
            <KeySecret
              secret={secret}
              onDone={() => secretBody.current?.closest("dialog")?.close()}
            />
          ) : null}
        </div>
      </Dialog>
    </section>
  );
}

function KeysSkeleton() {
  return (
    <ul aria-hidden className="divide-y divide-line">
      {[0, 1].map((i) => (
        <li key={i} className="flex h-14 items-center gap-6 px-4 sm:px-5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="hidden h-4 w-28 @3xl:block" />
          <Skeleton className="hidden h-4 flex-1 @3xl:block" />
          <Skeleton className="ml-auto size-8" />
        </li>
      ))}
    </ul>
  );
}
