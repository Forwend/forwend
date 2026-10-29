/** The API's limits in characters (apps/backend/api/openapi.yaml, ClientRequest). */
export const CLIENT_LIMITS = {
  name: 200,
  email: 254,
  address: 500,
  taxId: 50,
  reference: 100,
} as const;

/** Who the client is: only how the form reads; the API stores the same fields for both. */
export const CLIENT_KINDS = { business: "business", person: "person" } as const;
