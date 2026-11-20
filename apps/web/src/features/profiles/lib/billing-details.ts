import { BILLING_DETAILS_COPY } from "@/features/profiles/constants/profiles-copy";
import type { BillingDetailsBody } from "@/features/profiles/types/billing-details";
import { EMAIL_PATTERN } from "@/shared/constants/email";

export function billingErrors(
  body: BillingDetailsBody,
): Partial<Record<keyof BillingDetailsBody, string>> {
  const shown: Partial<Record<keyof BillingDetailsBody, string>> = {};
  for (const field of ["name", "address", "email"] as const) {
    if (!body[field]) shown[field] = BILLING_DETAILS_COPY.errors.required;
  }
  if (body.email && !EMAIL_PATTERN.test(body.email))
    shown.email = BILLING_DETAILS_COPY.errors.email;
  if (!body.country) shown.country = BILLING_DETAILS_COPY.errors.country;
  return shown;
}
