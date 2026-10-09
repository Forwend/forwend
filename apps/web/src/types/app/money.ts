import type {
  ACTIVITY_KINDS,
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
} from "@/constants/app";

/** One enabled token's money for a profile (GET /v1/profiles/{id}/balances, TokenBalance). Amounts are base units. */
export interface TokenBalance {
  chainId: number;
  token: string;
  symbol: string;
  decimals: number;
  /** null when the wallet balance could not be read. */
  wallet: string | null;
  finalizedBlock: number | null;
  pending: string;
  held: string;
}

export interface Balances {
  tokens: TokenBalance[];
  /** Wallet balances at 1 USD per stablecoin, "12.50"; null when any balance is missing. */
  estimatedUsdTotal: string | null;
}

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
