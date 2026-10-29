import { cx } from "@forwend/ui-web";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { PAYMENT_STEPS } from "@/features/jobs/constants/jobs";
import { paymentStep } from "@/features/jobs/lib/jobs";
import type { JobPayment, PaymentStep as Step } from "@/features/jobs/types/jobs";

const MARK: Record<Step, string> = {
  [PAYMENT_STEPS.paid]: "border-ink bg-ink text-surface",
  [PAYMENT_STEPS.invoiced]: "border-accent text-ink",
  [PAYMENT_STEPS.change]: "border-dashed border-line-strong text-muted",
  [PAYMENT_STEPS.upcoming]: "border-line-strong text-muted",
};

export interface PaymentStepProps {
  payment: JobPayment;
  first: boolean;
  last: boolean;
  /** The payment's lines; the amount sits at their end. */
  children: ReactNode;
  amount: ReactNode;
}

/** One payment on a job's timeline: its mark, joined to the next by a line, then its lines and amount. The row's
 * text says its state, so the mark is for the eye only. Paid is ink and the invoice under way olive, as on the pay
 * page's progress. */
export function PaymentStep({ payment, first, last, children, amount }: PaymentStepProps) {
  const step = paymentStep(payment);
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-x-3 px-4 sm:px-5">
      <span aria-hidden className="flex flex-col items-center">
        <span className={cx("h-3 w-px", first ? "bg-transparent" : "bg-line-strong")} />
        <span
          className={cx(
            "grid size-6 shrink-0 place-items-center rounded-pill border-2 text-xs font-medium tabular-nums",
            MARK[step],
          )}
        >
          {step === PAYMENT_STEPS.paid ? (
            <Check className="size-3.5" strokeWidth={3} />
          ) : (
            payment.position
          )}
        </span>
        <span className={cx("w-px flex-1", last ? "bg-transparent" : "bg-line-strong")} />
      </span>
      <div className={cx("flex min-w-0 flex-col items-start gap-1 pt-3", last ? "pb-4" : "pb-5")}>
        {children}
      </div>
      <p className="pt-3 text-right font-medium tabular-nums text-ink">{amount}</p>
    </li>
  );
}
