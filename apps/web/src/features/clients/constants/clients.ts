/** The API's limits in characters (apps/backend/api/openapi.yaml, ClientRequest). */
export const CLIENT_LIMITS = {
  name: 200,
  email: 254,
  address: 500,
  taxId: 50,
  reference: 100,
} as const;

/** R-177: the clients list's page, and how many a client picker shows for what is typed. */
export const CLIENTS_PAGE_SIZE = 20;
export const CLIENT_PICKER_SIZE = 20;

/** Who the client is: only how the form reads; the API stores the same fields for both. */
export const CLIENT_KINDS = { business: "business", person: "person" } as const;
