/** The API's limits in characters (apps/backend/api/openapi.yaml, BillingDetailsRequest). */
export const BILLING_LIMITS = {
  name: 200,
  address: 500,
  taxId: 50,
  email: 254,
} as const;
