import {
  PAYMENT_STATUS,
  type PaymentStatus,
  WALLET_STATE,
  type WalletState,
} from "@forwend/ui-web";
import {
  API_PAYMENT_STATES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
  API_WALLET_STATES,
} from "@/shared/constants/payment-state";
import type { ApiPaymentState } from "@/shared/types/payment-state";

/** The facts a payment record carries, whichever list or detail read it came from. */
export interface PaymentFacts {
  paymentStatus: string;
  confirming?: boolean;
  closed: boolean;
  /** The backend's derived state (D-114), when the read has it. */
  state?: string | null;
  /** Exact base units held for the payer: a paid payment with any reads Overpaid. */
  held?: string | null;
  /** A numbered invoice's due date (YYYY-MM-DD): waiting past it reads Overdue. */
  dueDate?: string | null;
}

/** Each API state's status: the label and icon a pill or a filter shows for it. */
export const STATE_STATUS: Readonly<Record<ApiPaymentState, PaymentStatus>> = {
  [API_PAYMENT_STATES.waiting]: PAYMENT_STATUS.open,
  [API_PAYMENT_STATES.confirming]: PAYMENT_STATUS.confirming,
  [API_PAYMENT_STATES.partiallyPaid]: PAYMENT_STATUS.partiallyPaid,
  [API_PAYMENT_STATES.paid]: PAYMENT_STATUS.paid,
  [API_PAYMENT_STATES.overpaid]: PAYMENT_STATUS.overpaid,
  [API_PAYMENT_STATES.expired]: PAYMENT_STATUS.expired,
  [API_PAYMENT_STATES.canceled]: PAYMENT_STATUS.canceled,
};

const RAW: Readonly<Record<string, PaymentStatus>> = {
  [API_PAYMENT_STATUSES.open]: PAYMENT_STATUS.open,
  [API_PAYMENT_STATUSES.detected]: PAYMENT_STATUS.confirming,
  [API_PAYMENT_STATUSES.partiallyPaid]: PAYMENT_STATUS.partiallyPaid,
  [API_PAYMENT_STATUSES.paid]: PAYMENT_STATUS.paid,
  [API_PAYMENT_STATUSES.expired]: PAYMENT_STATUS.expired,
  [API_PAYMENT_STATUSES.expiredPartiallyPaid]: PAYMENT_STATUS.expiredPartiallyPaid,
  [API_PAYMENT_STATUSES.canceled]: PAYMENT_STATUS.canceled,
};

/** One payment status for every list, detail, activity row and toast (D-114). Unknown values read Detected, never
 * as arrived money; a closed payment that can no longer complete reads expired (R-77). */
export function paymentStatusOf(facts: PaymentFacts, today = new Date()): PaymentStatus {
  const raw = rawStatus(facts);
  const state = facts.state ? STATE_STATUS[facts.state as ApiPaymentState] : undefined;
  // Expired, partly paid is a kind of expired: it names money the merchant keeps, and lets an invoice reopen (R-130).
  const status =
    state && !(state === PAYMENT_STATUS.expired && raw === PAYMENT_STATUS.expiredPartiallyPaid)
      ? state
      : raw;
  if (status === PAYMENT_STATUS.paid && facts.held && BigInt(facts.held) > 0n) {
    return PAYMENT_STATUS.overpaid;
  }
  if (status === PAYMENT_STATUS.open && facts.dueDate && facts.dueDate < isoDay(today)) {
    return PAYMENT_STATUS.overdue;
  }
  return status;
}

function rawStatus({ paymentStatus, confirming, closed }: PaymentFacts): PaymentStatus {
  const pending =
    confirming &&
    (paymentStatus === API_PAYMENT_STATUSES.partiallyPaid ||
      paymentStatus === API_PAYMENT_STATUSES.open);
  const status = pending
    ? PAYMENT_STATUS.confirming
    : (RAW[paymentStatus] ?? PAYMENT_STATUS.detected);
  if (!closed) return status;
  // Detected and closed: only money after the close, held for the payer; nothing on time can still complete it.
  if (status === PAYMENT_STATUS.open || status === PAYMENT_STATUS.confirming)
    return PAYMENT_STATUS.expired;
  if (status === PAYMENT_STATUS.partiallyPaid) return PAYMENT_STATUS.expiredPartiallyPaid;
  return status;
}

const WALLET: Readonly<Record<string, WalletState>> = {
  [API_WALLET_STATES.none]: WALLET_STATE.none,
  [API_WALLET_STATES.pending]: WALLET_STATE.pending,
  [API_WALLET_STATES.inWallet]: WALLET_STATE.inWallet,
  [API_WALLET_STATES.delayed]: WALLET_STATE.delayed,
  [API_WALLET_STATES.refused]: WALLET_STATE.refused,
};

export interface WalletFacts {
  settlementStatus: string;
  wallet?: string | null;
}

/** Where the merchant's share is, kept apart from the payment status: an unpaid payment has nothing to move. */
export function walletStateOf({ settlementStatus, wallet }: WalletFacts): WalletState {
  if (wallet && WALLET[wallet]) return WALLET[wallet];
  if (settlementStatus === API_SETTLEMENT_STATUSES.settled) return WALLET_STATE.inWallet;
  if (settlementStatus === API_SETTLEMENT_STATUSES.pending) return WALLET_STATE.pending;
  return WALLET_STATE.none;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
