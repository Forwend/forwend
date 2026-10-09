"use client";

import { ACTIVITY_DIRECTIONS, ActivityRow, Button, Skeleton } from "@forwend/ui-web";
import { useState } from "react";
import { ACTIVITY_KINDS, ACTIVITY_MAX, ACTIVITY_PAGE_SIZE, REFRESH_MS } from "@/constants/app";
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

// Invoices and their payments, newest first. "Show more" asks for more rows in one request (up to the API's 100), so
// the regular refresh reads the same rows again and never skips or repeats one between pages. An invoice is a
// request, so its amount has no sign; only a payment shows "+".
export function ActivityList({
  profileId,
  token,
}: {
  profileId: string;
  token: () => Promise<string>;
}) {
  const [shown, setShown] = useState({ profileId, limit: ACTIVITY_PAGE_SIZE });
  const limit = shown.profileId === profileId ? shown.limit : ACTIVITY_PAGE_SIZE;
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

  return (
    <section
      aria-labelledby="activity-title"
      aria-busy={!list.data && !list.failed}
      className="flex flex-col gap-4"
    >
      <h2 id="activity-title" className="text-lg font-medium text-ink">
        {COPY.activity}
      </h2>
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
        <p className="text-muted">{COPY.emptyActivity}</p>
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
          {more && limit < ACTIVITY_MAX ? (
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
