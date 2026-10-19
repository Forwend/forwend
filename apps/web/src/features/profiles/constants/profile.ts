/** Profile kinds from the API (D-20). */
export const PROFILE_KINDS = {
  personal: "personal",
  freelancer: "freelancer",
  merchant: "merchant",
} as const;

export const PROFILE_KIND_LABELS = {
  [PROFILE_KINDS.personal]: "Personal",
  [PROFILE_KINDS.freelancer]: "Freelancer",
  [PROFILE_KINDS.merchant]: "Merchant",
} as const;

/** ?then= on the billing details page: where saving them leads instead of home (R-92). */
export const BILLING_THEN = {
  param: "then",
  newInvoice: "new-invoice",
  newJob: "new-job",
  transactions: "transactions",
} as const;

/** Profiles a user can create; the personal one is made at signup. */
export const NEW_PROFILE_KINDS = [PROFILE_KINDS.freelancer, PROFILE_KINDS.merchant] as const;

/** The API's name limit (apps/backend/api/openapi.yaml, CreateProfileRequest.name). */
export const PROFILE_NAME_MAX = 64;
