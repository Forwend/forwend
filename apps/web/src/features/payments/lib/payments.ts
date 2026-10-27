import {
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
} from "@/features/activity/constants/activity";
import { PAYMENT_PROBLEMS } from "@/features/payments/constants/payments";
import type { Payment } from "@/features/payments/types/payments";
export function paymentLabel(payment: Payment): string {
  return payment.title ?? payment.reference ?? `Payment ${payment.paymentId.slice(2, 10)}`;
}
export function paymentState(payment: Pick<Payment, "paymentStatus" | "closed">): string {
  const labels: Record<string, string> = {
    [API_PAYMENT_STATUSES.open]: payment.closed ? "Closed" : "Awaiting payment",
    [API_PAYMENT_STATUSES.detected]: payment.closed ? "Expired" : "Confirming",
    [API_PAYMENT_STATUSES.partiallyPaid]: payment.closed ? "Closed, partly paid" : "Partly paid",
    [API_PAYMENT_STATUSES.paid]: "Paid",
    [API_PAYMENT_STATUSES.expired]: "Expired",
    [API_PAYMENT_STATUSES.expiredPartiallyPaid]: "Expired, partly paid",
    [API_PAYMENT_STATUSES.canceled]: "Canceled",
  };
  return labels[payment.paymentStatus] ?? "Unknown payment state";
}
export function settlementState(status: string): string {
  return (
    (
      {
        [API_SETTLEMENT_STATUSES.none]: "No settlement",
        [API_SETTLEMENT_STATUSES.pending]: "Settlement pending",
        [API_SETTLEMENT_STATUSES.settled]: "Settled into wallet",
      } as Record<string, string>
    )[status] ?? "Unknown settlement state"
  );
}
export function problemLabel(code: string): string {
  return PAYMENT_PROBLEMS[code as keyof typeof PAYMENT_PROBLEMS] ?? "Payment needs review";
}
