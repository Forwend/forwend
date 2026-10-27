import { EmptyState, ROW_INTERACTIVE_CLASSES, StatusPill } from "@forwend/ui-web";
import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { PaymentAmount } from "@/features/payments/components/payment-amount";
import { PaymentReceived } from "@/features/payments/components/payment-received";
import {
  paymentDisplayStatus,
  paymentLabel,
  paymentState,
  settlementState,
} from "@/features/payments/lib/payments";
import type { Payment, PaymentProblem } from "@/features/payments/types/payments";
import { APP_ROUTES } from "@/shared/config/routes";

export interface PaymentRowsProps {
  items: readonly (Payment & { problems?: PaymentProblem[] })[];
}

export function PaymentRows({ items }: PaymentRowsProps) {
  if (!items.length)
    return (
      <EmptyState
        icon={ArrowLeftRight}
        title="No matching payments"
        description="Payments appear here when a customer opens checkout or you create an invoice."
      />
    );
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted [&>th]:px-3 [&>th]:py-3 [&>th]:font-medium [&>th:first-child]:pl-0 [&>th:last-child]:pr-0">
              <th scope="col">Order</th>
              <th scope="col">Customer</th>
              <th scope="col" className="text-right">
                Requested
              </th>
              <th scope="col" className="text-right">
                Received
              </th>
              <th scope="col">Status</th>
              <th scope="col">Wallet</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((payment) => (
              <tr
                key={payment.paymentId}
                className={`relative ${ROW_INTERACTIVE_CLASSES} [&>td]:px-3 [&>td]:py-3 [&>td:first-child]:pl-0 [&>td:last-child]:pr-0`}
              >
                <td className="max-w-48">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`${APP_ROUTES.payments}/${payment.paymentId}`}
                      className="block min-w-0 truncate font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:outline-focus"
                    >
                      {paymentLabel(payment)}
                    </Link>
                    {!payment.livemode ? (
                      <span className="shrink-0 text-xs text-warning">Testnet</span>
                    ) : null}
                  </div>
                </td>
                <td className="max-w-40 truncate text-muted">
                  {payment.customerName || payment.customerEmail || "—"}
                </td>
                <td className="whitespace-nowrap text-right">
                  <PaymentAmount
                    amount={payment.amount}
                    decimals={payment.decimals}
                    symbol={payment.optionCount > 1 ? "USD" : payment.symbol}
                  />
                </td>
                <td className="whitespace-nowrap text-right">
                  <PaymentReceived payment={payment} />
                </td>
                <td className="whitespace-nowrap">
                  <StatusPill status={paymentDisplayStatus(payment)} />
                </td>
                <td className="whitespace-nowrap text-muted">
                  {payment.settlementStatus === "none"
                    ? "—"
                    : settlementState(payment.settlementStatus)}
                </td>
                <td className="whitespace-nowrap text-muted">
                  {new Date(payment.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line border-y border-line md:hidden">
        {items.map((payment) => (
          <li
            key={payment.paymentId}
            className={`relative flex flex-col gap-2 py-4 ${ROW_INTERACTIVE_CLASSES}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`${APP_ROUTES.payments}/${payment.paymentId}`}
                  className="block truncate font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:outline-focus"
                >
                  {paymentLabel(payment)}
                </Link>
                {!payment.livemode ? <span className="text-xs text-warning">Testnet</span> : null}
                <p className="truncate text-sm text-muted">
                  {payment.customerName ||
                    payment.customerEmail ||
                    new Date(payment.createdAt).toLocaleDateString()}
                </p>
              </div>
              <PaymentAmount
                amount={payment.amount}
                decimals={payment.decimals}
                symbol={payment.optionCount > 1 ? "USD" : payment.symbol}
              />
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span>{paymentState(payment)}</span>
              <span className="text-muted">
                Received <PaymentReceived payment={payment} />
              </span>
            </div>
            {payment.settlementStatus !== "none" ? (
              <p className="text-xs text-muted">{settlementState(payment.settlementStatus)}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
