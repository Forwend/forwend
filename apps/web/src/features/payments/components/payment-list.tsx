"use client";
import { Button, EmptyState } from "@forwend/ui-web";
import { ArrowLeftRight, CircleCheck } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import {
  useGetPaymentAttentionInfiniteQuery,
  useGetPaymentsInfiniteQuery,
} from "@/features/payments/api/payments-api";
import { PaymentsTable } from "@/features/payments/components/payments-table";
import { PAYMENTS_COPY as COPY } from "@/features/payments/constants/payments-copy";
import type { PaymentFilters } from "@/features/payments/types/payments";
import { LoadError } from "@/shared/components/load-error";
import { NoMatch } from "@/shared/components/no-match";
import { RowsSkeleton, SKELETON_ROWS } from "@/shared/components/rows-skeleton";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { APP_ROUTES } from "@/shared/config/routes";

export interface PaymentListProps {
  profileId: string;
  filters?: PaymentFilters;
  attention?: boolean;
  showStore?: boolean;
  /** Whether a search or filter narrows the list: an empty answer then offers to clear it. */
  filtered?: boolean;
  onClear?: () => void;
  /** What an empty, unfiltered list says, when it is not the whole Payments page (a link's purchases). */
  empty?: { title: string; text: string; action?: ReactNode };
}

export function PaymentList({
  profileId,
  filters,
  attention = false,
  showStore,
  filtered,
  onClear,
  empty,
}: PaymentListProps) {
  // Polling refetches every loaded page, so the list stays live only while it shows its first page.
  const [pages, setPages] = useState(1);
  const live = { ...LIVE_QUERY, pollingInterval: pages > 1 ? 0 : LIVE_QUERY.pollingInterval };
  const all = useGetPaymentsInfiniteQuery({ profileId, filters }, { ...live, skip: attention });
  const issues = useGetPaymentAttentionInfiniteQuery(
    { profileId, filters },
    { ...live, skip: !attention },
  );
  const list = attention ? issues : all;
  // A new filter keeps the last rows in place, dimmed, until its own answer arrives: no flash of a skeleton.
  const data = list.currentData ?? (list.isFetching ? list.data : undefined);
  const stale = !list.currentData && Boolean(data);
  const loaded = data?.pages.length ?? 1;
  if (loaded !== pages) setPages(loaded);
  const rows = data?.pages.flatMap((page) => page.items) ?? [];
  const endpoints = attention ? issues.currentData?.pages[0] : undefined;

  if (!data) {
    return list.isError ? (
      <LoadError
        message={COPY.failed}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
      />
    ) : (
      <RowsSkeleton count={SKELETON_ROWS} className="fw-panel" />
    );
  }
  return (
    <div
      aria-busy={stale || undefined}
      className={`flex flex-col gap-4 transition-opacity duration-[var(--fw-duration-fast)] ${stale ? "opacity-60" : ""}`}
    >
      {list.isError ? (
        <LoadError
          message={COPY.stale}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : null}
      {rows.length === 0 ? (
        filtered && onClear ? (
          <NoMatch onClear={onClear} />
        ) : attention ? (
          <EmptyState
            icon={CircleCheck}
            title={COPY.attentionEmptyTitle}
            description={COPY.attentionEmptyText}
          />
        ) : (
          <EmptyState
            icon={ArrowLeftRight}
            title={empty?.title ?? COPY.emptyTitle}
            description={empty?.text ?? COPY.emptyText}
            action={empty?.action}
          />
        )
      ) : (
        <PaymentsTable
          rows={rows}
          attention={attention}
          showStore={showStore}
          footer={
            list.hasNextPage ? (
              <div className="flex items-center justify-between gap-3 text-sm text-muted">
                {COPY.shown(rows.length)}
                <Button
                  size="sm"
                  variant="secondary"
                  loading={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  {COPY.more}
                </Button>
              </div>
            ) : undefined
          }
        />
      )}
      {endpoints?.webhooks.length ? (
        <section aria-labelledby="endpoint-problems" className="fw-panel">
          <div className="fw-panel-head">
            <h2 id="endpoint-problems" className="font-medium text-ink">
              {COPY.webhooks}
            </h2>
            <p className="ml-auto text-xs text-muted">{COPY.webhooksNote}</p>
          </div>
          <ul className="divide-y divide-line">
            {endpoints.webhooks.map((endpoint) => (
              <li
                key={endpoint.endpointId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5"
              >
                <span className="text-ink">
                  {COPY.webhookRow(endpoint.description, endpoint.failed, endpoint.disabledPending)}
                </span>
                <Link
                  href={APP_ROUTES.developers}
                  className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                >
                  {COPY.checkWebhooks}
                </Link>
              </li>
            ))}
          </ul>
          {endpoints.webhooksTruncated ? (
            <p className="border-t border-line px-4 py-2.5 text-sm text-muted sm:px-5">
              {COPY.moreWebhooks}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
