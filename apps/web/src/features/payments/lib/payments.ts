import type { PaymentStatus } from "@forwend/ui-web";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import {
  HELD_REASONS,
  PAYMENT_PROBLEMS,
  PROBLEM_CODES,
} from "@/features/payments/constants/payments";
import { PAYMENT_DETAIL_COPY } from "@/features/payments/constants/payments-copy";
import type { Payment, PaymentParam, PaymentProblem } from "@/features/payments/types/payments";
import { APP_ROUTES } from "@/shared/config/routes";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { amountText } from "@/shared/lib/money";
import { paymentStatusOf } from "@/shared/lib/payment-state";

export function paymentLabel(
  payment: Pick<Payment, "reference" | "number" | "title" | "paymentId">,
): string {
  return (
    payment.reference ??
    (payment.number ? invoiceNumber(payment.number) : null) ??
    payment.title ??
    MONEY_COPY.checkout(payment.paymentId)
  );
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

export function problemLabel(problem: Pick<PaymentProblem, "code" | "reason">): string {
  const label =
    PAYMENT_PROBLEMS[problem.code as keyof typeof PAYMENT_PROBLEMS] ?? "Payment needs review";
  const why = problem.code === PROBLEM_CODES.heldFunds ? heldWhy(problem) : undefined;
  return why ? `${label}: ${why}` : label;
}

function heldWhy(problem: Pick<PaymentProblem, "reason">): string | undefined {
  return problem.reason ? HELD_REASONS[problem.reason as keyof typeof HELD_REASONS] : undefined;
}

export function heldHint(problems: readonly PaymentProblem[]): string | null {
  const held = problems.flatMap((p) =>
    p.code === PROBLEM_CODES.heldFunds && p.amount && p.asset
      ? [PAYMENT_DETAIL_COPY.held(amountText(BigInt(p.amount), p.asset), heldWhy(p))]
      : [],
  );
  return held.length ? held.join(" ") : null;
}

export function receivedAmount(amounts: Payment["amounts"]): string {
  return (
    BigInt(amounts.payable) +
    BigInt(amounts.held) +
    BigInt(amounts.settled) +
    BigInt(amounts.fees ?? "0") +
    BigInt(amounts.refunded)
  ).toString();
}

/** The option the figures follow: the recorded one once money decided it, else the first funded. */
export function leadOption<T extends { optionId: string }>(
  payment: Pick<Payment, "optionId" | "optionLocked">,
  options: readonly T[],
  funded: (option: T) => boolean,
): T | undefined {
  return payment.optionLocked
    ? options.find((option) => option.optionId === payment.optionId)
    : options.find(funded);
}

export function optionFigures(
  amount: string,
  receipt: { received: string; pending: string; held?: string } | undefined,
): { received: bigint; extra: bigint; due: bigint } {
  const asked = BigInt(amount);
  const received = BigInt(receipt?.received ?? "0");
  const held = BigInt(receipt?.held ?? "0");
  const pending = BigInt(receipt?.pending ?? "0");
  return {
    received,
    // Once booked, held is the truth: 0 after a return.
    extra: held > 0n ? held : pending > 0n && received > asked ? received - asked : 0n,
    due: received < asked ? asked - received : 0n,
  };
}

export function paymentsHref(param: PaymentParam, value: string): string {
  return `${APP_ROUTES.payments}?${param}=${value}`;
}
