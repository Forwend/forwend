import { formatTokenAmount, PAYMENT_STATUS, type PaymentStatus } from "@forwend/ui-web";
import { chainName } from "@/shared/chains/chains";

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

// The filter each status falls under: Open is everything still on its way, Paid is money that is final but not in the
// wallet yet. Refunds show only under All.
const STATUS_FILTER_OF: Readonly<Record<PaymentStatus, StatusFilter | null>> = {
  [PAYMENT_STATUS.open]: STATUS_FILTERS.open,
  [PAYMENT_STATUS.detected]: STATUS_FILTERS.open,
  [PAYMENT_STATUS.confirming]: STATUS_FILTERS.open,
  [PAYMENT_STATUS.partiallyPaid]: STATUS_FILTERS.open,
  [PAYMENT_STATUS.confirmed]: STATUS_FILTERS.paid,
  [PAYMENT_STATUS.paid]: STATUS_FILTERS.paid,
  [PAYMENT_STATUS.overpaid]: STATUS_FILTERS.paid,
  [PAYMENT_STATUS.settled]: STATUS_FILTERS.settled,
  [PAYMENT_STATUS.expired]: STATUS_FILTERS.expired,
  [PAYMENT_STATUS.expiredPartiallyPaid]: STATUS_FILTERS.expired,
  [PAYMENT_STATUS.refundPending]: null,
  [PAYMENT_STATUS.refunded]: null,
};

export function matchesStatus(status: PaymentStatus, filter: StatusFilter): boolean {
  return filter === STATUS_FILTERS.all || STATUS_FILTER_OF[status] === filter;
}

/** A search as rows are matched: any letter case, and no thousands separators, so "1250" finds 1,250.00. */
export function searchQuery(search: string): string {
  return search.trim().toLowerCase().replaceAll(",", "");
}

/** Rows under the filter whose token, network, amount or transaction hash contains the search. */
export function filterActivity(
  items: readonly ActivityItem[],
  filter: StatusFilter,
  search: string,
): ActivityItem[] {
  const query = searchQuery(search);
  return items.filter(
    (item) =>
      matchesStatus(activityStatus(item), filter) &&
      (!query ||
        [
          item.symbol,
          chainName(item.chainId),
          item.txHash ?? "",
          formatTokenAmount({ baseUnits: BigInt(item.amount), decimals: item.decimals }),
        ].some((text) => searchQuery(text).includes(query))),
  );
}
