import { PAYMENT_STATUS, type PaymentStatus } from "@forwend/ui-web";

/** Invoice.paymentStatus values. */
export const API_PAYMENT_STATUSES = {
  open: "open",
  detected: "detected",
  partiallyPaid: "partially_paid",
  paid: "paid",
  expired: "expired",
  expiredPartiallyPaid: "expired_partially_paid",
} as const;

/** Invoice.settlementStatus values. */
export const API_SETTLEMENT_STATUSES = {
  none: "none",
  pending: "pending",
  settled: "settled",
} as const;

/** Deposit.status values. */
export const API_DEPOSIT_STATUSES = {
  detected: "detected",
  confirmed: "confirmed",
} as const;

/** Activity rows: up to this many in one request, the API's limit; "Show more" grows the request by a page. */
export const ACTIVITY_MAX = 100;

export const ACTIVITY_KINDS = {
  invoice: "invoice",
  deposit: "deposit",
} as const;

/** Items per activity page. */
export const ACTIVITY_PAGE_SIZE = 20;

/** The status filter on Invoices and Activity. */
export const STATUS_FILTERS = {
  all: "all",
  open: "open",
  paid: "paid",
  settled: "settled",
  expired: "expired",
} as const;

export type StatusFilter = (typeof STATUS_FILTERS)[keyof typeof STATUS_FILTERS];

export type ActivityKind = (typeof ACTIVITY_KINDS)[keyof typeof ACTIVITY_KINDS];

export type ApiPaymentStatus = (typeof API_PAYMENT_STATUSES)[keyof typeof API_PAYMENT_STATUSES];

export type ApiSettlementStatus =
  (typeof API_SETTLEMENT_STATUSES)[keyof typeof API_SETTLEMENT_STATUSES];

export type ApiDepositStatus = (typeof API_DEPOSIT_STATUSES)[keyof typeof API_DEPOSIT_STATUSES];

/** GET /v1/profiles/{id}/activity, ActivityItem. */
export interface ActivityItem {
  kind: ActivityKind;
  at: string;
  invoiceId: string;
  chainId: number;
  token: string;
  symbol: string;
  decimals: number;
  amount: string;
  /** An invoice's payment status or a deposit's status; other values may come from a newer API. */
  status: ApiPaymentStatus | ApiDepositStatus | (string & {});
  settlementStatus?: ApiSettlementStatus | (string & {});
  txHash?: string;
  /** Above 1 the client chooses: the invoice reads in USD, not in the token given here (its first option). */
  optionCount: number;
}

export interface ActivityPage {
  items: ActivityItem[];
  nextCursor: string | null;
}

// API payment statuses (openapi.yaml, Invoice.paymentStatus) to the statuses users see.
const INVOICE_STATUSES: Readonly<Record<string, PaymentStatus>> = {
  [API_PAYMENT_STATUSES.open]: PAYMENT_STATUS.open,
  [API_PAYMENT_STATUSES.detected]: PAYMENT_STATUS.detected,
  [API_PAYMENT_STATUSES.partiallyPaid]: PAYMENT_STATUS.partiallyPaid,
  [API_PAYMENT_STATUSES.paid]: PAYMENT_STATUS.paid,
  [API_PAYMENT_STATUSES.expired]: PAYMENT_STATUS.expired,
  [API_PAYMENT_STATUSES.expiredPartiallyPaid]: PAYMENT_STATUS.expiredPartiallyPaid,
};

/**
 * What an activity row shows: a deposit is "Confirming" until its block is final, then "Confirmed"; an invoice shows
 * "Settled" once its money reached the wallet, otherwise its payment status. Unknown values show as "Detected" rather
 * than claiming money arrived.
 */
export function activityStatus(
  item: Pick<ActivityItem, "kind" | "status" | "settlementStatus">,
): PaymentStatus {
  if (item.kind === ACTIVITY_KINDS.deposit) {
    return item.status === API_DEPOSIT_STATUSES.confirmed
      ? PAYMENT_STATUS.confirmed
      : PAYMENT_STATUS.confirming;
  }
  if (item.settlementStatus === API_SETTLEMENT_STATUSES.settled) return PAYMENT_STATUS.settled;
  return INVOICE_STATUSES[item.status] ?? PAYMENT_STATUS.detected;
}
