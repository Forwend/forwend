import type { BillingDetailsBody } from "@/features/profiles/types/billing-details";

export const BILLING_LIMITS = {
  name: 200,
  address: 500,
  taxId: 50,
  email: 254,
} as const;

export const BILLING_FIELDS: readonly (keyof BillingDetailsBody)[] = [
  "name",
  "address",
  "country",
  "taxId",
  "email",
];
