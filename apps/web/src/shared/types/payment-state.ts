import type {
  API_DEPOSIT_STATUSES,
  API_PAYMENT_STATES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
  PAYMENT_STATE_FILTERS,
} from "@/shared/constants/payment-state";

export type ApiPaymentStatus = (typeof API_PAYMENT_STATUSES)[keyof typeof API_PAYMENT_STATUSES];
export type ApiSettlementStatus =
  (typeof API_SETTLEMENT_STATUSES)[keyof typeof API_SETTLEMENT_STATUSES];
export type ApiDepositStatus = (typeof API_DEPOSIT_STATUSES)[keyof typeof API_DEPOSIT_STATUSES];

export type ApiPaymentState = (typeof API_PAYMENT_STATES)[keyof typeof API_PAYMENT_STATES];
export type PaymentStateFilter = (typeof PAYMENT_STATE_FILTERS)[keyof typeof PAYMENT_STATE_FILTERS];
