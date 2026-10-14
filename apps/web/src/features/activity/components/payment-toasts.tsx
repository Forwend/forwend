"use client";

import { formatTokenAmount, TONES, useToast } from "@forwend/ui-web";
import { useEffect, useRef, useState } from "react";
import { useGetActivityQuery } from "@/features/activity/api/activity-api";
import { ACTIVITY_PAGE_SIZE, API_DEPOSIT_STATUSES } from "@/features/activity/constants/activity";
import { ACTIVITY_COPY } from "@/features/activity/constants/activity-copy";
import { PAYMENT_EVENTS } from "@/features/activity/constants/payment-events";
import { newPaymentEvents } from "@/features/activity/lib/payment-events";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { exactDigits } from "@/shared/lib/money";

export interface PaymentToastsProps {
  profileId: string;
}

// ponytail: only the newest page is watched; a settle pushed off it gets no toast. Needs a settled-since API to fix.
export function PaymentToasts({ profileId }: PaymentToastsProps) {
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
      const units = BigInt(item.amount);
      const amount = `${formatTokenAmount({ baseUnits: units, decimals: item.decimals, fractionDigits: exactDigits(units, item.decimals) })} ${item.symbol}`;
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
