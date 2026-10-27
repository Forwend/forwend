import { PAYMENT_EVENTS } from "@/features/activity/constants/payment-events";
import type { PaymentEvent, PaymentEventKind } from "@/features/activity/types/payment-events";
import { INVOICE_EVENTS } from "@/features/invoices/constants/invoices";
import type { InvoiceEvent } from "@/features/invoices/types/invoices";

function eventOf(item: InvoiceEvent): { key: string; kind: PaymentEventKind } | null {
  const kind =
    item.kind === INVOICE_EVENTS.paid
      ? PAYMENT_EVENTS.paid
      : item.kind === INVOICE_EVENTS.settled
        ? PAYMENT_EVENTS.settled
        : null;
  return kind ? { key: String(item.id), kind } : null;
}

// No seen set means the first load: payments already there are not news.
export function newPaymentEvents(seen: Set<string> | undefined, items: InvoiceEvent[]) {
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
