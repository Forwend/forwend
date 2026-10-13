/** GET /v1/profiles/{profileId}/billing-details; the PUT body has the same fields without updatedAt. */
export interface BillingDetails {
  name: string;
  address: string;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string;
  taxId: string | null;
  email: string;
  updatedAt: string;
}

export type BillingDetailsBody = Omit<BillingDetails, "updatedAt">;
