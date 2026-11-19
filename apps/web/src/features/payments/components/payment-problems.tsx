import { buttonClasses, Notice } from "@forwend/ui-web";
import Link from "next/link";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { PROBLEM_ACTIONS, PROBLEM_CODES } from "@/features/payments/constants/payments";
import { PAYMENT_DETAIL_COPY } from "@/features/payments/constants/payments-copy";
import { problemLabel } from "@/features/payments/lib/payments";
import type { PaymentProblem } from "@/features/payments/types/payments";
import { APP_ROUTES } from "@/shared/config/routes";

const COPY = PAYMENT_DETAIL_COPY.problems;

const SHOWN_ELSEWHERE = new Set<string>([
  PROBLEM_CODES.partialPayment,
  PROBLEM_CODES.heldFunds,
  PROBLEM_CODES.verificationPending,
  PROBLEM_CODES.settlementRefused,
]);

export interface PaymentProblemsProps {
  problems: readonly PaymentProblem[];
}

export function PaymentProblems({ problems }: PaymentProblemsProps) {
  const seen = new Set<string>();
  const shown = problems.filter((problem) => {
    if (
      SHOWN_ELSEWHERE.has(problem.code) ||
      (problem.action === PROBLEM_ACTIONS.wait &&
        (problem.code === PROBLEM_CODES.outflowUnreconciled ||
          problem.code === PROBLEM_CODES.settlementDelayed))
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
            problem.action === PROBLEM_ACTIONS.reviewWebhooks ? (
              <Link
                href={APP_ROUTES.developers}
                className={buttonClasses({ variant: "link", size: "sm" })}
              >
                {COPY.checkWebhooks}
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
          {problem.code === PROBLEM_CODES.webhookDelivery
            ? problem.action === PROBLEM_ACTIONS.askAdmin
              ? COPY.webhookAskAdmin
              : COPY.webhook
            : COPY.support}
        </Notice>
      ))}
    </div>
  );
}
