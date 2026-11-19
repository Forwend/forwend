// Must match CreateJobRequest in apps/backend/api/openapi.yaml.
export const JOB_LIMITS = {
  title: 200,
  scope: 5000,
  payments: 10,
  paymentTitle: 100,
  dueDays: 90,
  deliveryLink: 2000,
} as const;

export const JOBS_PAGE_SIZE = 20;

// Field names as the API's 422 messages start.
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

// Events at the same time sort in this order.
export const RECORD_EVENTS = {
  created: "created",
  accepted: "accepted",
  proposed: "proposed",
  changeAccepted: "changeAccepted",
  done: "done",
  invoiced: "invoiced",
  paid: "paid",
} as const;

export const JOB_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export const ACCEPT_FIELDS = { name: "name", email: "email" } as const;

export const CHANGE_ERRORS = { pending: "change_pending", finished: "job_finished" } as const;

export const PAYMENT_FIELDS = { title: "title", amount: "amount", dueDays: "dueDays" } as const;

export const PAYMENT_STEPS = {
  paid: "paid",
  invoiced: "invoiced",
  change: "change",
  upcoming: "upcoming",
} as const;
