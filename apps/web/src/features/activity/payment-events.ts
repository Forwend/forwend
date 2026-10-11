import {
  ACTIVITY_KINDS,
  type ActivityItem,
  API_SETTLEMENT_STATUSES,
} from "@/features/activity/activity";

export const PAYMENT_EVENTS = {
  detected: "detected",
  settled: "settled",
} as const;

export type PaymentEventKind = (typeof PAYMENT_EVENTS)[keyof typeof PAYMENT_EVENTS];

export interface PaymentEvent {
  kind: PaymentEventKind;
  item: ActivityItem;
}

// A deposit is one payment detected; an invoice whose settlement is booked is one payment settled.
function eventOf(item: ActivityItem): { key: string; kind: PaymentEventKind } | null {
  if (item.kind === ACTIVITY_KINDS.deposit) {
    return { key: `deposit:${item.invoiceId}:${item.txHash}`, kind: PAYMENT_EVENTS.detected };
  }
  if (item.settlementStatus === API_SETTLEMENT_STATUSES.settled) {
    return { key: `settled:${item.invoiceId}`, kind: PAYMENT_EVENTS.settled };
  }
  return null;
}

/**
 * The payment events in items that seen does not hold yet, and adds them to seen. With no seen set (the first load)
 * nothing is new: those payments happened before the app opened.
 */
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
