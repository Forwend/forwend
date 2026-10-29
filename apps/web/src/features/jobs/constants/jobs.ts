/** The API's limits (apps/backend/api/openapi.yaml, CreateJobRequest). */
export const JOB_LIMITS = {
  title: 200,
  scope: 5000,
  payments: 10,
  paymentTitle: 100,
  dueDays: 90,
  deliveryLink: 2000,
} as const;

/** Fields the API names in a 422, as its messages start (R-100). */
export const JOB_FIELDS = {
  title: "title",
  scope: "scope",
  clientName: "client.name",
  clientEmail: "client.email",
  clientAddress: "client.address",
  clientCountry: "client.country",
  clientTaxId: "client.taxId",
  payments: "payments",
} as const;

/** An email as the forms check it before sending; the API checks it again. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What a job's record lists (R-104), in the order events at the same time happened. */
export const RECORD_EVENTS = {
  created: "created",
  accepted: "accepted",
  proposed: "proposed",
  changeAccepted: "changeAccepted",
  done: "done",
  invoiced: "invoiced",
  paid: "paid",
} as const;

/** A job's link token: the secret in /w/<token> (R-102). */
export const JOB_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** The accept form's fields, as the API's 422 names them. */
export const ACCEPT_FIELDS = { name: "name", email: "email" } as const;

/** The API's error codes a scope change's 409 can carry (R-105). */
export const CHANGE_ERRORS = { pending: "change_pending", finished: "job_finished" } as const;

export const PAYMENT_FIELDS = { title: "title", amount: "amount", dueDays: "dueDays" } as const;

/** Where a payment stands on the job's Payments timeline. */
export const PAYMENT_STEPS = {
  paid: "paid",
  invoiced: "invoiced",
  change: "change",
  upcoming: "upcoming",
} as const;
