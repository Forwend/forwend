import { PROFILE_KIND_LABELS } from "@/features/profiles/constants/profile";
import type { Profile } from "@/features/profiles/types/profile";

export function profileLabel(profile: Profile): string {
  const kind = PROFILE_KIND_LABELS[profile.kind];
  return profile.name ? `${kind} · ${profile.name}` : kind;
}
