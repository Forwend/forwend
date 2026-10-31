/** A checkout's payment status, as the API names it. The API may add more, so a page should ignore one it doesn't know. */
export const PAYMENT_STATUSES = {
  open: "open",
  detected: "detected",
  partiallyPaid: "partially_paid",
  paid: "paid",
  expired: "expired",
  expiredPartiallyPaid: "expired_partially_paid",
  canceled: "canceled",
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[keyof typeof PAYMENT_STATUSES];

/** What the embedded checkout posts to its page (D-117). */
export const CHECKOUT_EVENTS = {
  ready: "ready",
  resize: "resize",
  status: "status",
} as const;

/** The checkout is drawn: its height and the payment's status then. */
export interface CheckoutReadyEvent {
  invoiceId: string;
  height: number;
  paymentStatus: PaymentStatus | (string & {});
}

/** The payment's status changed. A hint for the page only: fulfil the order from the webhook. */
export interface CheckoutStatusEvent {
  invoiceId: string;
  paymentStatus: PaymentStatus | (string & {});
}

export type CheckoutMessage =
  | ({ type: typeof CHECKOUT_EVENTS.ready } & CheckoutReadyEvent)
  | { type: typeof CHECKOUT_EVENTS.resize; invoiceId: string; height: number }
  | ({ type: typeof CHECKOUT_EVENTS.status } & CheckoutStatusEvent);

/** What the checkout in frame posted, or null for anything else: another window, another origin or another shape. */
export function checkoutMessage(
  event: MessageEvent,
  frame: HTMLIFrameElement,
  origin: string,
): CheckoutMessage | null {
  if (event.source !== frame.contentWindow || event.origin !== origin) return null;
  const data: unknown = event.data;
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.source !== "forwend" || m.v !== 1 || typeof m.invoiceId !== "string") return null;
  const invoiceId = m.invoiceId;
  const height =
    typeof m.height === "number" && Number.isFinite(m.height) && m.height >= 0 ? m.height : null;
  const paymentStatus = typeof m.paymentStatus === "string" ? m.paymentStatus : null;
  switch (m.type) {
    case CHECKOUT_EVENTS.ready:
      return height !== null && paymentStatus !== null
        ? { type: CHECKOUT_EVENTS.ready, invoiceId, height, paymentStatus }
        : null;
    case CHECKOUT_EVENTS.resize:
      return height !== null ? { type: CHECKOUT_EVENTS.resize, invoiceId, height } : null;
    case CHECKOUT_EVENTS.status:
      return paymentStatus !== null
        ? { type: CHECKOUT_EVENTS.status, invoiceId, paymentStatus }
        : null;
    default:
      return null;
  }
}
