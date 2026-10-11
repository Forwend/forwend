"use client";

import { formatTokenAmount, TONES, useToast } from "@forwend/ui-web";
import { useEffect, useRef, useState } from "react";
import { ACTIVITY_PAGE_SIZE, API_DEPOSIT_STATUSES } from "@/features/activity/activity";
import { useGetActivityQuery } from "@/features/activity/activity-api";
import { ACTIVITY_COPY } from "@/features/activity/activity-copy";
import { newPaymentEvents, PAYMENT_EVENTS } from "@/features/activity/payment-events";
import { LIVE_QUERY } from "@/shared/config/refresh";

// Toasts for payments to the active profile while the app is open, from its activity polled every REFRESH_MS (the
// Activity page shares the request when it has no filter or search). ponytail: only the newest ACTIVITY_PAGE_SIZE
// items are watched, so an invoice that settles after many newer items pushed it out of that page gets no toast; read
// a settled-since API if that matters.
export function PaymentToasts({ profileId }: { profileId: string }) {
  return <ProfileToasts key={profileId} profileId={profileId} />;
}

// One per profile visit: payments that arrived while another profile was open are old news on return.
function ProfileToasts({ profileId }: { profileId: string }) {
  const toast = useToast();
  const [openedAt] = useState(Date.now);
  const list = useGetActivityQuery(
    { profileId, limit: ACTIVITY_PAGE_SIZE },
    { ...LIVE_QUERY, refetchOnMountOrArgChange: true },
  );
  const seen = useRef<Set<string>>(undefined);
  // The first answer read after the visit started is the baseline, not a cached one from an earlier visit.
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
