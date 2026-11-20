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

export const PERMISSIONS = {
  invoicesRead: "invoices.read",
  invoicesWrite: "invoices.write",
  storesRead: "stores.read",
  storesWrite: "stores.write",
  clientsRead: "clients.read",
  moneyRead: "money.read",
  moneyMove: "money.move", // the owner's alone
  billingRead: "billing.read",
  billingWrite: "billing.write",
  tokensRead: "tokens.read",
  tokensWrite: "tokens.write",
  jobs: "jobs",
  notifications: "notifications",
  team: "team",
  leave: "team.leave",
  keys: "keys",
  webhooks: "webhooks",
} as const;

/** ?then= on the billing details page: where saving leads instead of home. */
export const BILLING_THEN = {
  param: "then",
  newInvoice: "new-invoice",
  newJob: "new-job",
  transactions: "transactions",
} as const;

/** The personal profile is made at signup. */
export const NEW_PROFILE_KINDS = [PROFILE_KINDS.freelancer, PROFILE_KINDS.merchant] as const;

export const PROFILE_NAME_MAX = 64;

export const PROFILES_MAX = 10;

/** The owner's fee comes off at settlement; the client's goes on top of the price. */
export const FEES_PAID_BY = { owner: "owner", client: "client" } as const;
