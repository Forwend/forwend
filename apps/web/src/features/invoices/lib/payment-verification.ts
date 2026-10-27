import { RECONCILIATION_STATES } from "@/features/invoices/constants/invoices";
import type { InvoiceOption } from "@/features/invoices/types/invoices";
export function paymentVerification(
  options: readonly Pick<InvoiceOption, "amounts">[],
): (typeof RECONCILIATION_STATES)[keyof typeof RECONCILIATION_STATES] {
  if (
    options.some(
      ({ amounts }) =>
        amounts?.hasPolicyException ||
        amounts?.reconciliationStatus === RECONCILIATION_STATES.review ||
        (amounts?.unreconciled && !amounts.reconciliationStatus),
    )
  )
    return RECONCILIATION_STATES.review;
  if (
    options.some(({ amounts }) => amounts?.reconciliationStatus === RECONCILIATION_STATES.pending)
  )
    return RECONCILIATION_STATES.pending;
  return RECONCILIATION_STATES.verified;
}
