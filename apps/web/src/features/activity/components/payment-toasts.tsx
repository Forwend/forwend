"use client";

import { formatTokenAmount, TONES, useToast } from "@forwend/ui-web";
import { useEffect, useRef, useState } from "react";
import { ACTIVITY_COPY } from "@/features/activity/constants/activity-copy";
import { PAYMENT_EVENTS } from "@/features/activity/constants/payment-events";
import { newPaymentEvents } from "@/features/activity/lib/payment-events";
import { useGetInvoiceEventsQuery } from "@/features/invoices/api/invoices-api";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { LIVE_QUERY } from "@/shared/config/refresh";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { exactDigits } from "@/shared/lib/money";

export interface PaymentToastsProps {
  profileId: string;
}

// The bell and toasts share the same cached business-event read.
export function PaymentToasts({ profileId }: PaymentToastsProps) {
  return <ProfileToasts key={profileId} profileId={profileId} />;
}

// Keyed by profile: payments that came while another profile was open are not news.
function ProfileToasts({ profileId }: { profileId: string }) {
  const toast = useToast();
  const [openedAt] = useState(Date.now);
  const list = useGetInvoiceEventsQuery(profileId, {
    ...LIVE_QUERY,
    refetchOnMountOrArgChange: true,
  });
  const seen = useRef<Set<string>>(undefined);
  // Never take the baseline from an earlier visit's cached answer.
  const fresh = (list.fulfilledTimeStamp ?? 0) >= openedAt;
  const items = fresh ? list.currentData : undefined;

  useEffect(() => {
    if (!items) return;
    const { seen: known, events } = newPaymentEvents(seen.current, items);
    seen.current = known;
    for (const { kind, item } of events) {
      const units = BigInt(item.amount);
      const amount = `${formatTokenAmount({ baseUnits: units, decimals: item.decimals, fractionDigits: exactDigits(units, item.decimals) })} ${item.symbol}`;
      const payment = item.number
        ? invoiceNumber(item.number)
        : (item.title ?? MONEY_COPY.checkout(item.invoiceId));
      toast({
        tone: TONES.success,
        ...(kind === PAYMENT_EVENTS.settled
          ? ACTIVITY_COPY.toasts.settled(amount, payment)
          : ACTIVITY_COPY.toasts.paid(amount, payment)),
      });
    }
  }, [items, toast]);

  return null;
}
