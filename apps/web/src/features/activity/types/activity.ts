import type {
  ACTIVITY_KINDS,
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
  STATUS_FILTERS,
} from "@/features/activity/constants/activity";

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
