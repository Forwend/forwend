import {
  formatTokenAmount,
  PAYMENT_STATUSES,
  type PaymentStatus,
  type WalletState,
} from "@forwend/ui-web";
import { invoiceNumber } from "@/features/invoices/lib/invoices";
import { HELD_REASONS, PAYMENT_PROBLEMS } from "@/features/payments/constants/payments";
import { PAYMENT_DETAIL_COPY } from "@/features/payments/constants/payments-copy";
import type { Payment, PaymentProblem } from "@/features/payments/types/payments";
import { MONEY_COPY } from "@/shared/constants/money-copy";
import { exactDigits } from "@/shared/lib/money";
import { paymentStatusOf, walletStateOf } from "@/shared/lib/payment-state";
/** What the merchant knows the payment by: their order reference, else the invoice number, else its title. */
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

/** A problem's name; held money also says why it is held. */
export function problemLabel(problem: Pick<PaymentProblem, "code" | "reason">): string {
  const label =
    PAYMENT_PROBLEMS[problem.code as keyof typeof PAYMENT_PROBLEMS] ?? "Payment needs review";
  const why = problem.code === "held_funds" ? heldWhy(problem) : undefined;
  return why ? `${label}: ${why}` : label;
}

function heldWhy(problem: Pick<PaymentProblem, "reason">): string | undefined {
  return problem.reason ? HELD_REASONS[problem.reason as keyof typeof HELD_REASONS] : undefined;
}

/** One sentence per held amount: how much, why, and that support returns it (D-118); null with none held. */
export function heldHint(problems: readonly PaymentProblem[]): string | null {
  const held = problems.filter((p) => p.code === "held_funds" && p.amount && p.asset);
  if (!held.length) return null;
  return held
    .map((p) => {
      const units = BigInt(p.amount ?? "0");
      const decimals = p.asset?.decimals ?? 0;
      const money = `${formatTokenAmount({ baseUnits: units, decimals, fractionDigits: exactDigits(units, decimals) })} ${p.asset?.symbol}`;
      return PAYMENT_DETAIL_COPY.held(money, heldWhy(p));
    })
    .join(" ");
}

export function receivedAmount(amounts: Payment["amounts"]): string {
  return (
    BigInt(amounts.payable) +
    BigInt(amounts.held) +
    BigInt(amounts.settled) +
    BigInt(amounts.refunded)
  ).toString();
}

/** The option a payment's figures follow: the one it is recorded on once money decided it, else the first with money.
 * Money on another option, even a smaller deposit listed first, shows apart from those figures. */
export function leadOption<T extends { optionId: string }>(
  payment: Pick<Payment, "optionId" | "optionLocked">,
  options: readonly T[],
  funded: (option: T) => boolean,
): T | undefined {
  return payment.optionLocked
    ? options.find((option) => option.optionId === payment.optionId)
    : options.find(funded);
}

/** One option's money against what it asked: received includes money still confirming. Extra is money held for the
 * payer once booked, else what arrived over the amount, which the ledger will hold for them (D-24). */
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
    // Until the ledger books it, the arithmetic shows the extra; once booked, held is the truth: 0 after a return.
    extra: held > 0n ? held : pending > 0n && received > asked ? received - asked : 0n,
    due: received < asked ? asked - received : 0n,
  };
}
