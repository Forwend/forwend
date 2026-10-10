"use client";

import { ACTIVITY_DIRECTIONS, ActivityRow, Button, Skeleton } from "@forwend/ui-web";
import { useState } from "react";
import {
  ACTIVITY_KINDS,
  ACTIVITY_MAX,
  ACTIVITY_PAGE_SIZE,
  activityStatus,
} from "@/features/activity/activity";
import { useGetActivityQuery } from "@/features/activity/activity-api";
import { ACTIVITY_COPY } from "@/features/activity/activity-copy";
import { chainName } from "@/shared/chains/chains";
import { LIVE_QUERY } from "@/shared/config/refresh";

// Short enough for a phone row: "Oct 10, 12:50 AM".
const TIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// Invoices and their payments, newest first, read again every REFRESH_MS. "Show more" asks for more rows in one
// request (up to the API's 100), so a refresh reads the same rows again and never skips or repeats one. An invoice is
// a request, so its amount has no sign; only a payment shows "+".
interface ActivityListProps {
  profileId: string;
}

// A new list per profile: the rows shown while more load are always this profile's.
export function ActivityList(props: ActivityListProps) {
  return <ProfileActivity key={props.profileId} {...props} />;
}

function ProfileActivity({ profileId }: ActivityListProps) {
  const [limit, setLimit] = useState<number>(ACTIVITY_PAGE_SIZE);
  const list = useGetActivityQuery({ profileId, limit }, LIVE_QUERY);
  const items = list.data?.items ?? [];
  const more = Boolean(list.data?.nextCursor);

  return (
    <section
      aria-labelledby="activity-title"
      aria-busy={!list.data && !list.isError}
      className="flex flex-col gap-4"
    >
      <h1 id="activity-title" className="text-2xl font-semibold tracking-tight text-ink">
        {ACTIVITY_COPY.activity}
      </h1>
      {list.isError && !list.data ? (
        <div role="alert" className="flex flex-wrap items-center gap-4 text-muted">
          {ACTIVITY_COPY.activityFailed}
          <Button size="sm" variant="secondary" onClick={list.refetch}>
            {ACTIVITY_COPY.retry}
          </Button>
        </div>
      ) : !list.data ? (
        <Skeleton className="h-24" />
      ) : items.length === 0 ? (
        <p className="py-2 text-muted">{ACTIVITY_COPY.emptyActivity}</p>
      ) : (
        <>
          <ul className="divide-y divide-line rounded-md border border-line bg-surface px-4">
            {items.map((item, i) => {
              const deposit = item.kind === ACTIVITY_KINDS.deposit;
              return (
                // The same transaction can pay two invoices, and one invoice can get two payments in it.
                // biome-ignore lint/suspicious/noArrayIndexKey: the position completes the key
                <li key={`${item.kind}:${item.invoiceId}:${item.txHash ?? ""}:${i}`}>
                  <ActivityRow
                    title={deposit ? ACTIVITY_COPY.deposit : ACTIVITY_COPY.invoice}
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
          {more && limit < ACTIVITY_MAX ? (
            <Button
              variant="secondary"
              className="self-start"
              loading={list.isFetching && items.length < limit}
              onClick={() => setLimit(Math.min(limit + ACTIVITY_PAGE_SIZE, ACTIVITY_MAX))}
            >
              {ACTIVITY_COPY.loadMore}
            </Button>
          ) : more ? (
            <p className="text-sm text-muted">{ACTIVITY_COPY.latestOnly}</p>
          ) : null}
        </>
      )}
    </section>
  );
}
