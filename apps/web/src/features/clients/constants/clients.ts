/** The API's limits in characters. */
export const CLIENT_LIMITS = {
  name: 200,
  email: 254,
  address: 500,
  taxId: 50,
  reference: 100,
} as const;

export const CLIENTS_PAGE_SIZE = 20;
export const CLIENT_PICKER_SIZE = 20;

/** Only how the form reads: the API stores the same fields for both. */
export const CLIENT_KINDS = { business: "business", person: "person" } as const;
