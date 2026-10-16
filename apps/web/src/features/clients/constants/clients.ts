/** The API's limits in characters (apps/backend/api/openapi.yaml, ClientRequest). */
export const CLIENT_LIMITS = {
  name: 200,
  email: 254,
  address: 500,
  taxId: 50,
} as const;

/** The country select's "none" choice: a select item can't have an empty value. */
export const NO_COUNTRY = "none";
