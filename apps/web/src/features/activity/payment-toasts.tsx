"use client";

import { formatTokenAmount, TONES, useToast } from "@forwend/ui-web";
import { useEffect, useRef, useState } from "react";
import { ACTIVITY_PAGE_SIZE, API_DEPOSIT_STATUSES } from "@/features/activity/activity";
import { useGetActivityQuery } from "@/features/activity/activity-api";
import { ACTIVITY_COPY } from "@/features/activity/activity-copy";
import { newPaymentEvents, PAYMENT_EVENTS } from "@/features/activity/payment-events";
import { LIVE_QUERY } from "@/shared/config/refresh";

// ponytail: only the newest page is watched; a settle pushed off it gets no toast. Needs a settled-since API to fix.
export function PaymentToasts({ profileId }: { profileId: string }) {
  return <ProfileToasts key={profileId} profileId={profileId} />;
}

// Keyed by profile: payments that came while another profile was open are not news.
function ProfileToasts({ profileId }: { profileId: string }) {
  const toast = useToast();
  const [openedAt] = useState(Date.now);
  const list = useGetActivityQuery(
    { profileId, limit: ACTIVITY_PAGE_SIZE },
    { ...LIVE_QUERY, refetchOnMountOrArgChange: true },
  );
  const seen = useRef<Set<string>>(undefined);
  // Never take the baseline from an earlier visit's cached answer.
  const fresh = (list.fulfilledTimeStamp ?? 0) >= openedAt;
  const items = fresh ? list.currentData?.items : undefined;

  useEffect(() => {
    if (!items) return;
    const { seen: known, events } = newPaymentEvents(seen.current, items);
    seen.current = known;
    for (const { kind, item } of events) {
      const amount = `${formatTokenAmount({ baseUnits: BigInt(item.amount), decimals: item.decimals })} ${item.symbol}`;
      toast(
        kind === PAYMENT_EVENTS.settled
          ? { tone: TONES.success, ...ACTIVITY_COPY.toasts.settled(amount) }
          : {
              tone: TONES.neutral,
              ...ACTIVITY_COPY.toasts.detected(
                amount,
                item.status === API_DEPOSIT_STATUSES.confirmed,
              ),
            },
      );
    }
  }, [items, toast]);

  return null;
}
