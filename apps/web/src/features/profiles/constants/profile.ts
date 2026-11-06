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

/** The signed-in user's role on a profile (R-138); the owner has every permission. */
export const ROLES = {
  owner: "owner",
  admin: "admin",
  developer: "developer",
  finance: "finance",
} as const;

export const ROLE_LABELS = {
  [ROLES.owner]: "Owner",
  [ROLES.admin]: "Admin",
  [ROLES.developer]: "Developer",
  [ROLES.finance]: "Finance",
} as const;

/** What a role may do, as GET /v1/me lists it for each profile (D-93); the app shows only what its role can use. */
export const PERMISSIONS = {
  invoicesRead: "invoices.read",
  invoicesWrite: "invoices.write",
  storesRead: "stores.read",
  storesWrite: "stores.write",
  clientsRead: "clients.read",
  moneyRead: "money.read",
  // Sending out of the wallet: the owner's alone (D-61).
  moneyMove: "money.move",
  billingRead: "billing.read",
  tokensRead: "tokens.read",
  jobs: "jobs",
  notifications: "notifications",
  team: "team",
  leave: "team.leave",
  keys: "keys",
  webhooks: "webhooks",
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

/** The most profiles one user can own (profile.MaxProfiles). */
export const PROFILES_MAX = 10;
