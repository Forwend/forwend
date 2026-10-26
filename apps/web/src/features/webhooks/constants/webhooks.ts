/** The events an endpoint can take (apps/backend/api/openapi.yaml, WebhookEndpoint), in the API's order. */
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

/** A new endpoint's events: paid and settled are what most servers act on; anything more is a choice. */
export const DEFAULT_EVENTS = [
  "invoice.paid",
  "invoice.settled",
] as const satisfies readonly (typeof WEBHOOK_EVENTS)[number][];

/** The owner's check of an endpoint (R-149): it names no invoice. */
export const TEST_EVENT = "webhook.test";

export const DELIVERY_STATUSES = {
  pending: "pending",
  succeeded: "succeeded",
  failed: "failed",
} as const;

/** Resend failed: the windows the owner picks from, in hours. Retries run for about 3 days (D-98). */
export const FAILED_SINCE_HOURS = [1, 24, 72, 168, 720] as const;
export const DEFAULT_FAILED_SINCE_HOURS = 72;

/** The API's limits. */
export const URL_MAX = 2048;
export const DESCRIPTION_MAX = 200;
