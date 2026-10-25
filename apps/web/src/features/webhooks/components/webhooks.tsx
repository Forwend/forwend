"use client";

import { Badge, Button, EmptyState, TONES } from "@forwend/ui-web";
import { Webhook } from "lucide-react";
import { useListStoresQuery } from "@/features/stores/api/stores-api";
import { useListEndpointsQuery } from "@/features/webhooks/api/webhooks-api";
import { EndpointActions } from "@/features/webhooks/components/endpoint-actions";
import { EndpointDialog } from "@/features/webhooks/components/endpoint-dialog";
import { WEBHOOKS_COPY as COPY } from "@/features/webhooks/constants/webhooks-copy";
import { endpointPlace } from "@/features/webhooks/lib/webhooks";
import { RowsSkeleton } from "@/shared/components/rows-skeleton";

export interface WebhooksProps {
  profileId: string;
  /** A merchant's endpoint may take one store; a freelancer has none. */
  merchant: boolean;
}

const ROW = "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5";

// R-149: the profile's webhook endpoints, newest first, each with where it sends, what, and whether it is on.
export function Webhooks({ profileId, merchant }: WebhooksProps) {
  const endpoints = useListEndpointsQuery(profileId);
  const stores = useListStoresQuery(profileId, { skip: !merchant });
  const names = new Map((stores.currentData ?? []).map((s) => [s.storeId, s.name]));

  // A merchant's rows wait for the store names, so a failed stores load needs the same way out.
  const storesFailed = merchant && stores.isError && !stores.currentData;
  if ((endpoints.isError && !endpoints.currentData) || storesFailed) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-4 text-sm text-muted">
        {COPY.loadFailed}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void endpoints.refetch();
            if (storesFailed) void stores.refetch();
          }}
        >
          {COPY.retry}
        </Button>
      </div>
    );
  }
  if (!endpoints.currentData || (merchant && !stores.currentData)) {
    return <RowsSkeleton count={2} className="fw-panel" />;
  }
  const storeList = merchant ? (stores.currentData ?? []) : null;
  return (
    <section aria-labelledby="webhooks" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="webhooks" className="text-lg font-semibold text-ink">
            {COPY.title}
          </h2>
          <p className="text-sm text-muted">{COPY.intro}</p>
        </div>
        <EndpointDialog profileId={profileId} stores={storeList} />
      </div>
      {endpoints.currentData.length === 0 ? (
        <EmptyState icon={Webhook} title={COPY.empty} description={COPY.emptyBody} />
      ) : (
        <ul className="fw-panel divide-y divide-line">
          {endpoints.currentData.map((endpoint) => (
            <li key={endpoint.endpointId} className={ROW}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">
                  {endpoint.description || endpointPlace(endpoint.url)}
                </span>
                <span className="block text-sm break-words text-muted">
                  {/* Without a description the title is already the host and path. */}
                  {endpoint.description ? (
                    <>
                      <code className="font-mono">{endpointPlace(endpoint.url)}</code>
                      {" · "}
                    </>
                  ) : null}
                  {endpoint.storeId
                    ? `${names.get(endpoint.storeId) ?? endpoint.storeId} · `
                    : null}
                  {endpoint.events.length <= 2
                    ? endpoint.events.map((type) => COPY.eventLabels[type]).join(", ")
                    : COPY.eventCount(endpoint.events.length)}
                </span>
              </span>
              {endpoint.enabled ? null : <Badge tone={TONES.neutral}>{COPY.off}</Badge>}
              {endpoint.livemode ? null : <Badge tone={TONES.warning}>{COPY.testMode}</Badge>}
              <EndpointActions profileId={profileId} stores={storeList} endpoint={endpoint} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
