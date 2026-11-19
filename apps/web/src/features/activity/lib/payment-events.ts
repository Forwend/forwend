import { INVOICE_EVENTS } from "@/features/invoices/constants/invoices";
import type { InvoiceEvent } from "@/features/invoices/types/invoices";

// Held money, delivery errors and unknown events are never announced as payment success.
const ANNOUNCED: readonly string[] = [INVOICE_EVENTS.paid, INVOICE_EVENTS.settled];

// No seen set means the first load: payments already there are not news.
export function newPaymentEvents(seen: Set<string> | undefined, items: InvoiceEvent[]) {
  const known = seen ?? new Set<string>();
  const events: InvoiceEvent[] = [];
  for (const item of items) {
    const key = String(item.id);
    if (!ANNOUNCED.includes(item.kind) || known.has(key)) continue;
    known.add(key);
    if (seen) events.push(item);
  }
  return { seen: known, events };
}
