"use client";
import { Button } from "@forwend/ui-web";
import Link from "next/link";
import {
  useGetPaymentAttentionInfiniteQuery,
  useGetPaymentsInfiniteQuery,
} from "@/features/payments/api/payments-api";
import { PaymentRows } from "@/features/payments/components/payment-rows";
import type { PaymentFilters } from "@/features/payments/types/payments";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";
export interface PaymentListProps {
  profileId: string;
  filters?: PaymentFilters;
  attention?: boolean;
}
export function PaymentList({ profileId, filters, attention = false }: PaymentListProps) {
  const all = useGetPaymentsInfiniteQuery(
    { profileId, filters },
    { ...LIVE_QUERY, skip: attention },
  );
  const problems = useGetPaymentAttentionInfiniteQuery(
    { profileId, filters },
    { ...LIVE_QUERY, skip: !attention },
  );
  const list = attention ? problems : all;
  const rows = list.currentData?.pages.flatMap((page) => page.items) ?? [];
  const endpoints = attention ? problems.currentData?.pages[0] : undefined;
  return (
    <div className="flex flex-col gap-4" aria-busy={!list.currentData && !list.isError}>
      {list.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          We could not refresh payments.
          {list.currentData ? " The last loaded records are shown." : ""}
          <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {!list.currentData ? (
        !list.isError ? (
          <p role="status" className="text-sm text-muted">
            Loading payments…
          </p>
        ) : null
      ) : (
        <>
          <PaymentRows items={rows} />
          {list.hasNextPage ? (
            <Button
              variant="secondary"
              onClick={() => void list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
            >
              Show more payments
            </Button>
          ) : null}
        </>
      )}
      {endpoints?.webhooks.length ? (
        <section aria-labelledby="endpoint-problems" className="fw-panel p-4 sm:p-5">
          <h2 id="endpoint-problems" className="font-medium text-ink">
            Webhook delivery
          </h2>
          <p className="mt-1 text-sm text-muted">
            This section follows store and mode access. Payment source and status filters apply to
            the payment list above.
          </p>
          <ul className="mt-3 divide-y divide-line">
            {endpoints.webhooks.map((endpoint) => (
              <li
                key={endpoint.endpointId}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <span>
                  {endpoint.description || "Webhook endpoint"} · {endpoint.failed} failed
                  {endpoint.disabledPending ? `, ${endpoint.disabledPending} paused` : ""}
                </span>
                <Link
                  href={APP_ROUTES.developers}
                  className="text-info underline underline-offset-4"
                >
                  Check webhooks
                </Link>
              </li>
            ))}
          </ul>
          {endpoints.webhooksTruncated ? (
            <p className="text-sm text-muted">
              More endpoints need attention. Open Developers for the full list.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
