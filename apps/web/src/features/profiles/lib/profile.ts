import { BILLING_THEN, PROFILE_KIND_LABELS } from "@/features/profiles/constants/profile";
import type { BillingThen, Permission, Profile } from "@/features/profiles/types/profile";
import { APP_ROUTES } from "@/shared/config/routes";

export function profileLabel(profile: Profile): string {
  const kind = PROFILE_KIND_LABELS[profile.kind];
  return profile.name ? `${kind} · ${profile.name}` : kind;
}

export function can(profile: Profile, permission: Permission): boolean {
  return profile.permissions.includes(permission);
}

/** The billing details page, which returns to `then` once saved. */
export function billingDetailsHref(then: BillingThen): string {
  return `${APP_ROUTES.billingDetails}?${BILLING_THEN.param}=${then}`;
}
