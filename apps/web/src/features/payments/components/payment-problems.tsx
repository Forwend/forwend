import { buttonClasses, Notice } from "@forwend/ui-web";
import Link from "next/link";
import { problemLabel } from "@/features/payments/lib/payments";
import type { PaymentProblem } from "@/features/payments/types/payments";
import { APP_ROUTES } from "@/shared/config/routes";

// The page already says these: Extra in Amount, the wallet transfer's state in Transfers, Still due, the status.
const SHOWN_ELSEWHERE = new Set([
  "held_funds",
  "settlement_refused",
  "settlement_delayed",
  "outflow_unreconciled",
  "partial_payment",
  "verification_pending",
]);

export interface PaymentProblemsProps {
  problems: readonly PaymentProblem[];
}

/** The problems a payment's page shows nowhere else, each as one warning strip under its header. */
export function PaymentProblems({ problems }: PaymentProblemsProps) {
  const shown = problems.filter((problem) => !SHOWN_ELSEWHERE.has(problem.code));
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
          <span className="font-medium">{problemLabel(problem.code)}.</span>{" "}
          {problem.code === "webhook_delivery"
            ? problem.action === "ask_admin"
              ? "The payment is fine. Ask an Admin to check delivery."
              : "The payment is fine."
            : "Contact support with this payment's reference."}
        </Notice>
      ))}
    </div>
  );
}
