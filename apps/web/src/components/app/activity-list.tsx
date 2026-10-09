"use client";

import { ACTIVITY_DIRECTIONS, ActivityRow, Button, Skeleton } from "@forwend/ui-web";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  ACTIVITY_KINDS,
  ACTIVITY_MAX,
  ACTIVITY_PAGE_SIZE,
  APP_ROUTES,
  REFRESH_MS,
} from "@/constants/app";
import { PROFILE_PAGE_COPY as COPY } from "@/constants/profile-page";
import { activityStatus } from "@/lib/activity";
import { getActivity } from "@/lib/api";
import { chainName } from "@/lib/chain";
import { useLoad } from "@/lib/use-load";

// Short enough for a phone row: "Oct 10, 12:50 AM".
const TIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// Invoices and their payments, newest first, read again every REFRESH_MS. On the dashboard (preview) it shows the
// latest few and links to the Activity page; there, "Show more" asks for more rows in one request (up to the API's
// 100), so a refresh reads the same rows again and never skips or repeats one. An invoice is a request, so its amount
// has no sign; only a payment shows "+".
export function ActivityList({
  profileId,
  token,
  preview,
}: {
  profileId: string;
  token: () => Promise<string>;
  /** On the dashboard: this many rows and a "View all" link. */
  preview?: number;
}) {
  const [shown, setShown] = useState({ profileId, limit: ACTIVITY_PAGE_SIZE });
  const limit = preview ?? (shown.profileId === profileId ? shown.limit : ACTIVITY_PAGE_SIZE);
  const list = useLoad(
    async () => getActivity(await token(), profileId, limit),
    [profileId, limit],
    {
      refreshMs: REFRESH_MS,
      resetKey: profileId,
    },
  );
  const items = list.data?.items ?? [];
  const more = Boolean(list.data?.nextCursor);
  const Heading = preview ? "h2" : "h1";

  return (
    <section
      aria-labelledby="activity-title"
      aria-busy={!list.data && !list.failed}
      className={
        preview
          ? "flex flex-col gap-2 rounded-lg border border-line bg-surface p-6"
          : "flex flex-col gap-4"
      }
    >
      <div className="flex items-center justify-between gap-4">
        <Heading
          id="activity-title"
          className={preview ? "text-sm text-muted" : "font-display text-3xl text-ink sm:text-4xl"}
        >
          {preview ? COPY.recentActivity : COPY.activity}
        </Heading>
        {preview && items.length > 0 ? (
          <Link
            href={APP_ROUTES.activity}
            className="inline-flex h-11 items-center gap-1 rounded-pill px-3 text-sm text-ink hover:bg-surface-2"
          >
            {COPY.viewAll}
            <ChevronRight aria-hidden className="size-[var(--fw-icon-sm)]" />
          </Link>
        ) : null}
      </div>
      {list.failed && !list.data ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-muted">
          {COPY.activityFailed}
          <Button size="sm" variant="secondary" onClick={list.reload}>
            {COPY.retry}
          </Button>
        </div>
      ) : !list.data ? (
        <Skeleton className="h-24" />
      ) : items.length === 0 ? (
        <p className="py-2 text-muted">{COPY.emptyActivity}</p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {items.map((item, i) => {
              const deposit = item.kind === ACTIVITY_KINDS.deposit;
              return (
                // The same transaction can pay two invoices, and one invoice can get two payments in it.
                // biome-ignore lint/suspicious/noArrayIndexKey: the position completes the key
                <li key={`${item.kind}:${item.invoiceId}:${item.txHash ?? ""}:${i}`}>
                  <ActivityRow
                    title={deposit ? COPY.deposit : COPY.invoice}
                    detail={`${TIME.format(new Date(item.at))} · ${chainName(item.chainId)}`}
                    direction={deposit ? ACTIVITY_DIRECTIONS.incoming : ACTIVITY_DIRECTIONS.request}
                    amount={{
                      baseUnits: BigInt(item.amount),
                      decimals: item.decimals,
                      token: item.symbol,
                    }}
                    status={activityStatus(item)}
                  />
                </li>
              );
            })}
          </ul>
          {preview ? null : more && limit < ACTIVITY_MAX ? (
            <Button
              variant="secondary"
              className="self-start"
              loading={list.loading && items.length < limit}
              onClick={() =>
                setShown({ profileId, limit: Math.min(limit + ACTIVITY_PAGE_SIZE, ACTIVITY_MAX) })
              }
            >
              {COPY.loadMore}
            </Button>
          ) : more ? (
            <p className="text-sm text-muted">{COPY.latestOnly}</p>
          ) : null}
        </>
      )}
    </section>
  );
}
