/** The API's limits (apps/backend/api/openapi.yaml, CreateJobRequest). */
export const JOB_LIMITS = {
  title: 200,
  scope: 5000,
  payments: 10,
  paymentTitle: 100,
  dueDays: 90,
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

/** A payment row's fields, each named on its own input when wrong. */
export const PAYMENT_FIELDS = { title: "title", amount: "amount", dueDays: "dueDays" } as const;
