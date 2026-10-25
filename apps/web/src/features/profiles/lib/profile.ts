import { PROFILE_KIND_LABELS } from "@/features/profiles/constants/profile";
import type { Permission, Profile } from "@/features/profiles/types/profile";

export function profileLabel(profile: Profile): string {
  const kind = PROFILE_KIND_LABELS[profile.kind];
  return profile.name ? `${kind} · ${profile.name}` : kind;
}

/** Whether the user's role on the profile allows it; the API refuses it otherwise (D-93). */
export function can(profile: Profile, permission: Permission): boolean {
  return profile.permissions.includes(permission);
}
