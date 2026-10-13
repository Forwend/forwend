import { ACTIVITY_KINDS, API_SETTLEMENT_STATUSES } from "@/features/activity/constants/activity";
import { PAYMENT_EVENTS } from "@/features/activity/constants/payment-events";
import type { ActivityItem } from "@/features/activity/types/activity";
import type { PaymentEvent, PaymentEventKind } from "@/features/activity/types/payment-events";

function eventOf(item: ActivityItem): { key: string; kind: PaymentEventKind } | null {
  if (item.kind === ACTIVITY_KINDS.deposit) {
    return { key: `deposit:${item.invoiceId}:${item.txHash}`, kind: PAYMENT_EVENTS.detected };
  }
  if (item.settlementStatus === API_SETTLEMENT_STATUSES.settled) {
    return { key: `settled:${item.invoiceId}`, kind: PAYMENT_EVENTS.settled };
  }
  return null;
}

// No seen set means the first load: payments already there are not news.
export function newPaymentEvents(seen: Set<string> | undefined, items: ActivityItem[]) {
  const known = seen ?? new Set<string>();
  const events: PaymentEvent[] = [];
  for (const item of items) {
    const event = eventOf(item);
    if (!event || known.has(event.key)) continue;
    known.add(event.key);
    if (seen) events.push({ kind: event.kind, item });
  }
  return { seen: known, events };
}
