import { PAYMENT_STATUS, type PaymentStatus } from "@forwend/ui-web";
import {
  ACTIVITY_KINDS,
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
} from "@/features/activity/constants/activity";
import type { ActivityItem } from "@/features/activity/types/activity";

// API payment statuses (openapi.yaml, Invoice.paymentStatus) to the statuses users see.
const INVOICE_STATUSES: Readonly<Record<string, PaymentStatus>> = {
  [API_PAYMENT_STATUSES.open]: PAYMENT_STATUS.open,
  [API_PAYMENT_STATUSES.detected]: PAYMENT_STATUS.confirming,
  [API_PAYMENT_STATUSES.partiallyPaid]: PAYMENT_STATUS.partiallyPaid,
  [API_PAYMENT_STATUSES.paid]: PAYMENT_STATUS.paid,
  [API_PAYMENT_STATUSES.expired]: PAYMENT_STATUS.expired,
  [API_PAYMENT_STATUSES.expiredPartiallyPaid]: PAYMENT_STATUS.expiredPartiallyPaid,
  [API_PAYMENT_STATUSES.canceled]: PAYMENT_STATUS.canceled,
};

/**
 * What an activity row shows: a deposit is "Confirming" until its block is final, then "Confirmed"; an invoice shows
 * "Settled" once its money reached the wallet, otherwise its payment status. Unknown values show as "Detected" rather
 * than claiming money arrived. The API keeps an invoice open until the chain is final past expiry; `closed` says sooner
 * that it can no longer be paid, so open and partly paid read as expired then, as the API's list filter files them
 * (R-77).
 */
export function activityStatus(
  item: Pick<ActivityItem, "kind" | "status" | "settlementStatus" | "closed">,
): PaymentStatus {
  if (item.kind === ACTIVITY_KINDS.deposit) {
    return item.status === API_DEPOSIT_STATUSES.confirmed
      ? PAYMENT_STATUS.confirmed
      : PAYMENT_STATUS.confirming;
  }
  if (item.settlementStatus === API_SETTLEMENT_STATUSES.settled) return PAYMENT_STATUS.settled;
  const status = INVOICE_STATUSES[item.status] ?? PAYMENT_STATUS.detected;
  if (item.closed) {
    // Detected and closed: only money after the close, held for the payer; nothing on time can still complete it.
    if (status === PAYMENT_STATUS.open || status === PAYMENT_STATUS.confirming)
      return PAYMENT_STATUS.expired;
    if (status === PAYMENT_STATUS.partiallyPaid) return PAYMENT_STATUS.expiredPartiallyPaid;
  }
  return status;
}
