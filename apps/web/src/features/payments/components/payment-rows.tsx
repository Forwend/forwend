import {
  Badge,
  EmptyState,
  ROW_INTERACTIVE_CLASSES,
  TABLE_HEAD_CLASSES,
  TABLE_ROW_CLASSES,
  TONES,
} from "@forwend/ui-web";
import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { PaymentProblems } from "@/features/payments/components/payment-problems";
import { SOURCE_LABELS } from "@/features/payments/constants/payments";
import { paymentLabel, paymentState, settlementState } from "@/features/payments/lib/payments";
import type { Payment, PaymentProblem } from "@/features/payments/types/payments";
import { NetworkName } from "@/shared/components/chains/network-name";
import { APP_ROUTES } from "@/shared/config/routes";
export interface PaymentRowsProps {
  items: readonly (Payment & { problems?: PaymentProblem[] })[];
}
export function PaymentRows({ items }: PaymentRowsProps) {
  if (items.length === 0)
    return (
      <EmptyState
        icon={ArrowLeftRight}
        title="No matching payments"
        description="Checkout attempts appear here, including attempts that have not been paid."
      />
    );
  return (
    <div className="fw-panel overflow-hidden">
      <table className="hidden w-full table-fixed text-sm sm:table">
        <thead className="hidden sm:table-header-group">
          <tr className={TABLE_HEAD_CLASSES}>
            <th scope="col" className="w-1/2">
              Payment
            </th>
            <th scope="col">State</th>
            <th scope="col" className="text-right">
              Requested
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((payment) => (
            <tr
              key={payment.paymentId}
              className={`relative grid gap-2 px-4 py-4 sm:table-row sm:px-0 sm:py-0 ${TABLE_ROW_CLASSES} ${ROW_INTERACTIVE_CLASSES}`}
            >
              <td className="min-w-0 sm:align-top">
                <Link
                  href={`${APP_ROUTES.payments}/${payment.paymentId}`}
                  className="block truncate font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                >
                  {paymentLabel(payment)}
                </Link>
                <p className="truncate text-xs text-muted">
                  {SOURCE_LABELS[payment.source]}
                  {payment.storeName ? ` · ${payment.storeName}` : ""}
                </p>
                <p className="text-xs text-muted">{new Date(payment.createdAt).toLocaleString()}</p>
                {payment.problems?.length ? (
                  <div className="relative z-10 mt-3">
                    <PaymentProblems problems={payment.problems} />
                  </div>
                ) : null}
              </td>
              <td className="sm:align-top">
                <p className="text-ink">{paymentState(payment)}</p>
                {payment.settlementStatus !== "none" ? (
                  <p className="text-xs text-muted">{settlementState(payment.settlementStatus)}</p>
                ) : null}
                {!payment.livemode ? <Badge tone={TONES.warning}>Test mode</Badge> : null}
              </td>
              <td className="text-left sm:text-right sm:align-top">
                <PaymentAmount
                  amount={payment.amount}
                  decimals={payment.decimals}
                  symbol={payment.optionCount > 1 ? "USD" : payment.symbol}
                />
                <p className="text-xs text-muted">
                  <NetworkName chainId={payment.chainId} />
                </p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-line sm:hidden">
        {items.map((payment) => (
          <li key={payment.paymentId} className="relative flex flex-col gap-3 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Link
                  href={`${APP_ROUTES.payments}/${payment.paymentId}`}
                  className="block truncate font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                >
                  {paymentLabel(payment)}
                </Link>
                <p className="truncate text-xs text-muted">
                  {SOURCE_LABELS[payment.source]}
                  {payment.storeName ? ` · ${payment.storeName}` : ""}
                </p>
              </div>
              <PaymentAmount
                amount={payment.amount}
                decimals={payment.decimals}
                symbol={payment.optionCount > 1 ? "USD" : payment.symbol}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{paymentState(payment)}</span>
              {!payment.livemode ? <Badge tone={TONES.warning}>Test mode</Badge> : null}
            </div>
            {payment.settlementStatus !== "none" ? (
              <p className="text-xs text-muted">{settlementState(payment.settlementStatus)}</p>
            ) : null}
            <p className="text-xs text-muted">
              <NetworkName chainId={payment.chainId} /> ·{" "}
              {new Date(payment.createdAt).toLocaleString()}
            </p>
            {payment.problems?.length ? (
              <div className="relative z-10">
                <PaymentProblems problems={payment.problems} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
