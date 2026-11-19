import {
  PAYMENT_STATUS,
  PAYMENT_STATUSES,
  type PaymentStatus,
  WALLET_STATE,
  type WalletState,
} from "@forwend/ui-web";
import {
  API_PAYMENT_STATES,
  API_PAYMENT_STATUSES,
  API_SETTLEMENT_STATUSES,
  API_WALLET_STATES,
  PAYMENT_STATE_FILTERS,
} from "@/shared/constants/payment-state";
import { PAYMENT_STATE_COPY } from "@/shared/constants/payment-state-copy";
import type { ApiPaymentState, PaymentStateFilter } from "@/shared/types/payment-state";

/** The facts a payment record carries, whichever list or detail read it came from. */
interface PaymentFacts {
  paymentStatus: string;
  confirming?: boolean;
  closed: boolean;
  state?: string | null; // the backend's derived state, when the read has it
  held?: string | null; // base units; any held makes a paid payment Overpaid
  dueDate?: string | null; // YYYY-MM-DD; waiting past it reads Overdue
}

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

/** One payment status for every reader; unknown values read Detected, never as arrived money. */
export function paymentStatusOf(facts: PaymentFacts, today = new Date()): PaymentStatus {
  const raw = rawStatus(facts);
  const state = facts.state ? STATE_STATUS[facts.state as ApiPaymentState] : undefined;
  // Expired, partly paid is a kind of expired: it names money the merchant keeps, and lets an invoice reopen.
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

interface WalletFacts {
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

/** What an empty payment list was narrowed by, as one sentence; undefined when nothing narrowed it. */
export function narrowedBy(
  query: string | undefined,
  state: PaymentStateFilter,
  ...more: (string | null)[]
): string | undefined {
  const text = [
    query ? PAYMENT_STATE_COPY.searched(query) : null,
    state === PAYMENT_STATE_FILTERS.all
      ? null
      : PAYMENT_STATE_COPY.statusIs(PAYMENT_STATUSES[STATE_STATUS[state]].label),
    ...more,
  ]
    .filter(Boolean)
    .join(", ");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : undefined;
}
