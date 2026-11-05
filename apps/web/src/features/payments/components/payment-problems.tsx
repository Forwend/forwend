import { buttonClasses, Notice } from "@forwend/ui-web";
import Link from "next/link";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { problemLabel } from "@/features/payments/lib/payments";
import type { PaymentProblem } from "@/features/payments/types/payments";
import { APP_ROUTES } from "@/shared/config/routes";

// The page already says these: Still due, the status and its held-money hint, and the wallet transfer's badge.
const SHOWN_ELSEWHERE = new Set([
  "partial_payment",
  "held_funds",
  "verification_pending",
  "settlement_refused",
]);

export interface PaymentProblemsProps {
  problems: readonly PaymentProblem[];
}

/** The problems a payment's page shows nowhere else, each once, as a warning strip under its header. */
export function PaymentProblems({ problems }: PaymentProblemsProps) {
  const seen = new Set<string>();
  const shown = problems.filter((problem) => {
    if (
      SHOWN_ELSEWHERE.has(problem.code) ||
      (problem.action === "wait" &&
        (problem.code === "outflow_unreconciled" || problem.code === "settlement_delayed"))
    )
      return false;
    // One failing webhook endpoint reports every event: one strip says it.
    const key = `${problem.code}:${problem.action}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!shown.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {shown.map((problem) => (
        <Notice
          key={`${problem.code}:${problem.optionId}:${problem.eventId}:${problem.endpointId}`}
          action={
            problem.action === "review_webhooks" ? (
              <Link
                href={APP_ROUTES.developers}
                className={buttonClasses({ variant: "link", size: "sm" })}
              >
                Check webhooks
              </Link>
            ) : null
          }
        >
          <span className="font-medium">
            {problemLabel(problem)}
            {problem.amount && problem.asset ? (
              <>
                {" "}
                · <PaymentAmount amount={problem.amount} {...problem.asset} />
              </>
            ) : null}
            .
          </span>{" "}
          {problem.code === "webhook_delivery"
            ? problem.action === "ask_admin"
              ? "Payment status is unchanged. Ask the account owner or an Admin to check delivery."
              : "Payment status is unchanged."
            : "Contact support with this payment's reference."}
        </Notice>
      ))}
    </div>
  );
}
