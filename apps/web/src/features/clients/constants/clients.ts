/** The API's limits in characters (apps/backend/api/openapi.yaml, ClientRequest). */
export const CLIENT_LIMITS = {
  name: 200,
  email: 254,
  address: 500,
  taxId: 50,
  reference: 100,
} as const;
