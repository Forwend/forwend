import type { API_PAYMENT_STATES, PAYMENT_STATE_FILTERS } from "@/shared/constants/payment-state";

export type ApiPaymentState = (typeof API_PAYMENT_STATES)[keyof typeof API_PAYMENT_STATES];
export type PaymentStateFilter = (typeof PAYMENT_STATE_FILTERS)[keyof typeof PAYMENT_STATE_FILTERS];
