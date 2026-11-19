/** In the API's order. */
export const WEBHOOK_EVENTS = [
  "invoice.detected",
  "invoice.partially_paid",
  "invoice.paid",
  "invoice.settled",
  "invoice.expired",
  "invoice.canceled",
  "invoice.held",
  "invoice.open",
  "invoice.reopened",
] as const;

export const DEFAULT_EVENTS = [
  "invoice.paid",
  "invoice.settled",
] as const satisfies readonly (typeof WEBHOOK_EVENTS)[number][];

export const TEST_EVENT = "webhook.test";

export const DELIVERY_STATUSES = {
  pending: "pending",
  succeeded: "succeeded",
  failed: "failed",
} as const;

export const FAILED_SINCE_HOURS = [1, 24, 72, 168, 720] as const;
export const DEFAULT_FAILED_SINCE_HOURS = 72;

export const URL_MAX = 2048;
export const DESCRIPTION_MAX = 200;
