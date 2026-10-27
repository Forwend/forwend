import { PAYMENT_STATUSES, type PaymentStatus } from "@forwend/ui-web";
import { ACTIVITY_KINDS, API_SETTLEMENT_STATUSES } from "@/features/activity/constants/activity";
import { activityStatus } from "@/features/activity/lib/activity";
import { PAYMENT_PROBLEMS } from "@/features/payments/constants/payments";
import type { Payment } from "@/features/payments/types/payments";
export function paymentLabel(payment: Payment): string {
  return payment.reference ?? payment.title ?? `Payment ${payment.paymentId.slice(2, 10)}`;
}
export function paymentDisplayStatus(
  payment: Pick<Payment, "paymentStatus" | "closed"> & Partial<Pick<Payment, "confirming">>,
): PaymentStatus {
  return activityStatus({
    kind: ACTIVITY_KINDS.invoice,
    status: payment.paymentStatus,
    paymentStatus: payment.paymentStatus,
    confirming: payment.confirming,
    closed: payment.closed,
  });
}

export function paymentState(payment: Parameters<typeof paymentDisplayStatus>[0]): string {
  return PAYMENT_STATUSES[paymentDisplayStatus(payment)].label;
}

export function settlementState(status: string): string {
  return (
    (
      {
        [API_SETTLEMENT_STATUSES.none]: "Not sent to wallet",
        [API_SETTLEMENT_STATUSES.pending]: "Wallet transfer pending",
        [API_SETTLEMENT_STATUSES.settled]: "In wallet",
      } as Record<string, string>
    )[status] ?? "Unknown settlement state"
  );
}
export function problemLabel(code: string): string {
  return PAYMENT_PROBLEMS[code as keyof typeof PAYMENT_PROBLEMS] ?? "Payment needs review";
}

export function receivedAmount(amounts: Payment["amounts"]): string {
  return (
    BigInt(amounts.payable) +
    BigInt(amounts.held) +
    BigInt(amounts.settled) +
    BigInt(amounts.refunded)
  ).toString();
}
