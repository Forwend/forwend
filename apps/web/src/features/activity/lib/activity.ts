import { PAYMENT_STATUS, type PaymentStatus } from "@forwend/ui-web";
import { ACTIVITY_KINDS } from "@/features/activity/constants/activity";
import type { ActivityItem } from "@/features/activity/types/activity";
import { API_DEPOSIT_STATUSES } from "@/shared/constants/payment-state";
import { paymentStatusOf } from "@/shared/lib/payment-state";

/** A deposit row has its own confirmation; an invoice row reads as its payment does everywhere else. */
export function activityStatus(
  item: Pick<
    ActivityItem,
    "kind" | "status" | "settlementStatus" | "closed" | "paymentStatus" | "confirming"
  >,
): PaymentStatus {
  if (!item.paymentStatus && item.kind === ACTIVITY_KINDS.deposit) {
    return item.status === API_DEPOSIT_STATUSES.confirmed
      ? PAYMENT_STATUS.confirmed
      : PAYMENT_STATUS.confirming;
  }
  return paymentStatusOf({
    paymentStatus: item.paymentStatus ?? item.status,
    confirming: item.confirming,
    closed: item.closed,
  });
}
