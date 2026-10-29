"use client";

import {
  Badge,
  cx,
  EmptyState,
  Skeleton,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
  TONES,
} from "@forwend/ui-web";
import { Webhook } from "lucide-react";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import {
  useListDeliveriesQuery,
  useListEndpointsQuery,
} from "@/features/webhooks/api/webhooks-api";
import { DeliveryStatusBadge } from "@/features/webhooks/components/deliveries";
import { EndpointActions } from "@/features/webhooks/components/endpoint-actions";
import { EndpointDialog } from "@/features/webhooks/components/endpoint-dialog";
import { WEBHOOKS_COPY as COPY } from "@/features/webhooks/constants/webhooks-copy";
import { endpointPlace } from "@/features/webhooks/lib/webhooks";
import type { WebhookEndpoint } from "@/features/webhooks/types/webhooks";
import { LoadError } from "@/shared/components/load-error";
import { dateTime, shortDate } from "@/shared/lib/dates";

export interface WebhooksProps {
  profileId: string;
  /** A merchant's endpoint may take one store; a freelancer has none. */
  merchant: boolean;
}

// The panel's width decides, not the screen's: below it a row keeps only the endpoint cell, which then lists the rest.
const WIDE = "hidden @3xl:table-cell";
const NARROW = "block text-xs text-muted @3xl:hidden";
const ROW = cx(TABLE_ROW_CLASSES, "max-sm:[&>td:first-child]:pl-4 max-sm:[&>td:last-child]:pr-3");

// R-149: the profile's webhook endpoints, newest first, each with where it sends, what, whether it is on and how its
// newest delivery went.
export function Webhooks({ profileId, merchant }: WebhooksProps) {
  const endpoints = useListEndpointsQuery(profileId);
  const stores = useListStoresQuery(profileId, { skip: !merchant });
  const names = new Map((stores.currentData ?? []).map((s) => [s.storeId, s.name]));

  // A merchant's rows wait for the store names, so a failed stores load needs the same way out.
  const storesFailed = merchant && stores.isError && !stores.currentData;
  if ((endpoints.isError && !endpoints.currentData) || storesFailed) {
    return (
      <LoadError
        message={COPY.loadFailed}
        retrying={endpoints.isFetching || stores.isFetching}
        onRetry={() => {
          void endpoints.refetch();
          if (storesFailed) void stores.refetch();
        }}
      />
    );
  }
  const list = endpoints.currentData;
  const loading = !list || (merchant && !stores.currentData);
  const storeList = merchant ? (stores.currentData ?? []) : null;
  // As on API keys: one badge for the panel while every endpoint is a test one.
  const allTest = !!list?.length && list.every((e) => !e.livemode);
  const store = (endpoint: WebhookEndpoint) =>
    endpoint.storeId ? (names.get(endpoint.storeId) ?? endpoint.storeId) : COPY.allStores;
  const events = (endpoint: WebhookEndpoint) =>
    endpoint.events.length <= 2
      ? endpoint.events.map((type) => COPY.eventLabels[type]).join(", ")
      : COPY.eventCount(endpoint.events.length);
  return (
    <section aria-labelledby="webhooks" className="fw-panel @container">
      <div className="fw-panel-head flex-wrap justify-between gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id="webhooks" className="text-base font-semibold text-ink">
            {COPY.title}
          </h2>
          {allTest ? <Badge tone={TONES.warning}>{COPY.testMode}</Badge> : null}
        </div>
        {loading ? null : <EndpointDialog profileId={profileId} stores={storeList} />}
        <p className="w-full text-xs text-muted">{COPY.intro}</p>
      </div>
      {loading ? (
        <EndpointsSkeleton />
      ) : list.length === 0 ? (
        <EmptyState compact icon={Webhook} title={COPY.empty} description={COPY.emptyBody} />
      ) : (
        <table className="w-full table-fixed text-sm">
          <thead className="hidden @3xl:table-header-group">
            <tr className={TABLE_HEAD_CLASSES}>
              <th scope="col">{COPY.columns.endpoint}</th>
              {merchant ? (
                <th scope="col" className="w-[14%]">
                  {COPY.columns.store}
                </th>
              ) : null}
              <th scope="col" className="w-[20%]">
                {COPY.columns.events}
              </th>
              <th scope="col" className="w-20">
                {COPY.columns.status}
              </th>
              <th scope="col" className="w-40">
                {COPY.columns.lastDelivery}
              </th>
              <th scope="col" className="w-14">
                <span className="sr-only">{COPY.columns.actions}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((endpoint) => {
              const where = endpointPlace(endpoint.url);
              return (
                <tr key={endpoint.endpointId} className={ROW}>
                  <td>
                    <span className="flex min-w-0 items-center gap-2">
                      {/* Without a description the host and path lead the row, once. */}
                      {endpoint.description ? (
                        <span className="truncate font-medium text-ink">
                          {endpoint.description}
                        </span>
                      ) : (
                        <code className="truncate font-mono text-ink">{where}</code>
                      )}
                      <span className="@3xl:hidden">
                        <OnBadge enabled={endpoint.enabled} />
                      </span>
                      {!allTest && !endpoint.livemode ? (
                        <Badge tone={TONES.warning}>{COPY.testMode}</Badge>
                      ) : null}
                    </span>
                    {endpoint.description ? (
                      <code className="block truncate font-mono text-xs text-muted">{where}</code>
                    ) : null}
                    <span className={NARROW}>
                      {merchant ? `${store(endpoint)} · ` : null}
                      {events(endpoint)}
                    </span>
                    <span className="mt-1 block @3xl:hidden">
                      <LastDelivery profileId={profileId} endpointId={endpoint.endpointId} />
                    </span>
                  </td>
                  {merchant ? (
                    <td className={cx(WIDE, "truncate text-ink")}>{store(endpoint)}</td>
                  ) : null}
                  <td className={cx(WIDE, "truncate text-muted")} title={events(endpoint)}>
                    {events(endpoint)}
                  </td>
                  <td className={WIDE}>
                    <OnBadge enabled={endpoint.enabled} />
                  </td>
                  <td className={WIDE}>
                    <LastDelivery profileId={profileId} endpointId={endpoint.endpointId} />
                  </td>
                  <td className="w-14">
                    {/* Not text-right: the row's dialogs live in this cell and would inherit it. */}
                    <div className="flex justify-end">
                      <EndpointActions
                        profileId={profileId}
                        stores={storeList}
                        endpoint={endpoint}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function OnBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge tone={enabled ? TONES.success : TONES.neutral}>{enabled ? COPY.on : COPY.off}</Badge>
  );
}

/** The endpoint's health at a glance: how its newest delivery went. The Deliveries sheet has the rest. */
function LastDelivery({ profileId, endpointId }: { profileId: string; endpointId: string }) {
  const deliveries = useListDeliveriesQuery({ profileId, endpointId });
  const newest = deliveries.currentData?.[0];
  if (deliveries.isError && !deliveries.currentData)
    return <span className="text-xs text-muted">{COPY.lastDeliveryFailed}</span>;
  if (!deliveries.currentData) return <Skeleton className="h-5 w-28" />;
  if (!newest) return <span className="text-xs text-muted">{COPY.noDeliveries}</span>;
  return (
    <span className="flex min-w-0 items-center gap-2" title={dateTime(newest.createdAt)}>
      <DeliveryStatusBadge status={newest.status} />
      <span className="truncate text-xs text-muted tabular-nums">
        {shortDate(newest.createdAt)}
      </span>
    </span>
  );
}

function EndpointsSkeleton() {
  return (
    <ul aria-hidden className="divide-y divide-line">
      {[0, 1].map((i) => (
        <li key={i} className="flex h-14 items-center gap-6 px-4 sm:px-5">
          <span className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-44" />
          </span>
          <Skeleton className="hidden h-4 w-28 @3xl:block" />
          <Skeleton className="hidden h-5 w-12 @3xl:block" />
          <Skeleton className="ml-auto size-8" />
        </li>
      ))}
    </ul>
  );
}
