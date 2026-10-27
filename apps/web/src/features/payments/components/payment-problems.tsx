import { buttonClasses } from "@forwend/ui-web";
import Link from "next/link";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { problemLabel } from "@/features/payments/lib/payments";
import type { PaymentProblem } from "@/features/payments/types/payments";
import { NetworkName } from "@/shared/components/chains/network-name";
import { APP_ROUTES } from "@/shared/config/routes";
export interface PaymentProblemsProps {
  problems: readonly PaymentProblem[];
  hostedUrl?: string | null;
}
export function PaymentProblems({ problems, hostedUrl }: PaymentProblemsProps) {
  return (
    <ul className="flex flex-col gap-3">
      {problems.map((problem) => (
        <li
          key={`${problem.code}:${problem.optionId}:${problem.eventId}:${problem.endpointId}`}
          className="flex flex-wrap items-start justify-between gap-2 text-sm"
        >
          <div className="min-w-0">
            <p className="font-medium text-ink">
              {problemLabel(problem.code)}
              {problem.amount && problem.asset ? (
                <>
                  {" "}
                  · <PaymentAmount amount={problem.amount} {...problem.asset} />
                </>
              ) : null}
            </p>
            {problem.asset ? (
              <p className="text-xs text-muted">
                {problem.asset.symbol} · <NetworkName chainId={problem.asset.chainId} />
              </p>
            ) : null}
            <p className="text-muted">
              {problem.action === "wait"
                ? "Confirmation pending."
                : problem.action === "ask_admin"
                  ? "Ask the account owner or an Admin to check delivery."
                  : problem.code === "held_funds"
                    ? "This money is owed to the payer. No refund has been started."
                    : problem.action === "review_settlement"
                      ? "Check the transfer to your wallet."
                      : problem.code === "webhook_delivery"
                        ? "Delivery failed or is paused. Payment status is unchanged."
                        : problem.code === "partial_payment"
                          ? "The customer can use the same open checkout for the remaining amount."
                          : "Contact support with this payment reference."}
            </p>
          </div>
          {problem.action === "review_webhooks" ? (
            <Link
              href={APP_ROUTES.developers}
              className={buttonClasses({ variant: "link", size: "sm" })}
            >
              Check webhooks
            </Link>
          ) : problem.action === "share_checkout" && hostedUrl ? (
            <a href={hostedUrl} className={buttonClasses({ variant: "link", size: "sm" })}>
              Open checkout
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
