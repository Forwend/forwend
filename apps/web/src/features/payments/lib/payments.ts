import { PAYMENT_STATUSES, type PaymentStatus, type WalletState } from "@forwend/ui-web";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { PAYMENT_PROBLEMS } from "@/features/payments/constants/payments";
import { PAYMENT_DETAIL_COPY, PAYMENTS_COPY } from "@/features/payments/constants/payments-copy";
import type { Payment, PaymentDetail } from "@/features/payments/types/payments";
import { paymentStatusOf, walletStateOf } from "@/shared/lib/payment-state";
/** What the merchant knows the payment by: their order reference, else the invoice number, else its title. */
export function paymentLabel(
  payment: Pick<Payment, "reference" | "number" | "title" | "paymentId">,
): string {
  return (
    payment.reference ??
    (payment.number ? invoiceNumber(payment.number) : null) ??
    payment.title ??
    PAYMENTS_COPY.checkout(payment.paymentId)
  );
}

export function paymentWallet(payment: Pick<Payment, "settlementStatus" | "wallet">): WalletState {
  return walletStateOf(payment);
}
export function paymentDisplayStatus(
  payment: Pick<Payment, "paymentStatus" | "closed"> &
    Partial<Pick<Payment, "confirming" | "amounts">> & { state?: string | null },
): PaymentStatus {
  return paymentStatusOf({
    paymentStatus: payment.paymentStatus,
    confirming: payment.confirming,
    closed: payment.closed,
    state: payment.state,
    held: payment.amounts?.held,
  });
}

export function paymentState(payment: Parameters<typeof paymentDisplayStatus>[0]): string {
  return PAYMENT_STATUSES[paymentDisplayStatus(payment)].label;
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

// A confirmed deposit the ledger has not booked within this long reads as delayed, not routine.
const DELAYED_MS = 5 * 60 * 1000;

/** The one sentence a payment page leads with: what happened and what the merchant can do now. */
export function nextStep(payment: PaymentDetail): string {
  const next = PAYMENT_DETAIL_COPY.next;
  if (payment.problems.some((p) => p.action === "review_funds" && p.code !== "held_funds")) {
    return next.review;
  }
  const status = paymentDisplayStatus(payment);
  if (payment.refundStatus === "refunded") return next.returned;
  if (status === "canceled") return next.canceled;
  if (status === "overpaid") return next.overpaid;
  if (status === "paid") {
    return payment.settlementStatus === "settled" ? next.paid : next.paidPending;
  }
  const delayed = payment.options.some((option) =>
    option.deposits.some(
      (deposit) =>
        deposit.status === "confirmed" &&
        deposit.paid === null &&
        Date.parse(payment.snapshotAt) - Date.parse(deposit.blockTime) > DELAYED_MS,
    ),
  );
  // A partial payment whose rest is still being checked is confirming, not a reason to collect again.
  const checking = payment.problems.some(
    (p) => p.code === "partial_payment" && p.action === "wait",
  );
  if (status === "confirming" || checking) return delayed ? next.delayed : next.confirming;
  if (status === "expiredPartiallyPaid") return next.expiredPartly;
  if (status === "expired") return next.expired;
  if (status === "partiallyPaid") return next.partly;
  return next.waiting;
}
