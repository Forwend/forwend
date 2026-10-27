import { PAYMENT_STATUS, type PaymentStatus } from "@forwend/ui-web";
import {
  ACTIVITY_KINDS,
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
} from "@/features/activity/constants/activity";
import type { ActivityItem } from "@/features/activity/types/activity";

const INVOICE_STATUSES: Readonly<Record<string, PaymentStatus>> = {
  [API_PAYMENT_STATUSES.open]: PAYMENT_STATUS.open,
  [API_PAYMENT_STATUSES.detected]: PAYMENT_STATUS.confirming,
  [API_PAYMENT_STATUSES.partiallyPaid]: PAYMENT_STATUS.partiallyPaid,
  [API_PAYMENT_STATUSES.paid]: PAYMENT_STATUS.paid,
  [API_PAYMENT_STATUSES.expired]: PAYMENT_STATUS.expired,
  [API_PAYMENT_STATUSES.expiredPartiallyPaid]: PAYMENT_STATUS.expiredPartiallyPaid,
  [API_PAYMENT_STATUSES.canceled]: PAYMENT_STATUS.canceled,
};

/** Unknown values read "Detected", never as arrived money; a closed invoice reads expired (R-77). */
export function activityStatus(
  item: Pick<
    ActivityItem,
    "kind" | "status" | "settlementStatus" | "closed" | "paymentStatus" | "confirming"
  >,
): PaymentStatus {
  if (item.paymentStatus) {
    return activityStatus({
      kind: ACTIVITY_KINDS.invoice,
      status:
        item.confirming &&
        (item.paymentStatus === API_PAYMENT_STATUSES.partiallyPaid ||
          item.paymentStatus === API_PAYMENT_STATUSES.open)
          ? API_PAYMENT_STATUSES.detected
          : item.paymentStatus,
      settlementStatus: item.settlementStatus,
      closed: item.closed,
    });
  }
  if (item.kind === ACTIVITY_KINDS.deposit) {
    return item.status === API_DEPOSIT_STATUSES.confirmed
      ? PAYMENT_STATUS.confirmed
      : PAYMENT_STATUS.confirming;
  }
  const status = INVOICE_STATUSES[item.status] ?? PAYMENT_STATUS.detected;
  if (item.closed) {
    // Detected and closed: only money after the close, held for the payer; nothing on time can still complete it.
    if (status === PAYMENT_STATUS.open || status === PAYMENT_STATUS.confirming)
      return PAYMENT_STATUS.expired;
    if (status === PAYMENT_STATUS.partiallyPaid) return PAYMENT_STATUS.expiredPartiallyPaid;
  }
  return status;
}
