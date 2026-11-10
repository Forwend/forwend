import { PAYMENT_STATUS, type PaymentStatus } from "@forwend/ui-web";
import type { InvoiceSummary } from "@/features/invoices/types/invoices";

const DAY_MS = 86_400_000;

const PAYABLE: ReadonlySet<PaymentStatus> = new Set([
  PAYMENT_STATUS.open,
  PAYMENT_STATUS.overdue,
  PAYMENT_STATUS.partiallyPaid,
  PAYMENT_STATUS.detected,
  PAYMENT_STATUS.confirming,
]);

/** Whether the pay link is still worth sharing: a payable status, and a checkout that has not closed. The status
 * alone is not enough: a transfer sent on time can still confirm after the close, and money sent then is held
 * for a refund. The invoice page hides Copy link by the same rule. */
export function canStillBePaid(
  inv: Pick<InvoiceSummary, "closesAt">,
  status: PaymentStatus,
  now: Date,
): boolean {
  return PAYABLE.has(status) && Date.parse(inv.closesAt) > now.getTime();
}

/** Whole days from today to a YYYY-MM-DD due date: 0 today, negative once late. Both are UTC days, as the API
 * counts lateness. */
export function daysUntilDue(dueDate: string, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(`${dueDate}T00:00:00Z`) - today) / DAY_MS);
}
