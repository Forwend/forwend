import type { Profile } from "@/features/profiles/types/profile";

// Remembered per signed-in user in this browser, so a reload or a new tab opens the same profile.
const storageKey = (userId: string) => `forwend:profile:${userId}`;

/** The profile with the remembered id, or the first (personal) one when it is not among the user's profiles. */
export function chosenProfile(profiles: Profile[], profileId: string | null): Profile | undefined {
  return profiles.find((p) => p.profileId === profileId) ?? profiles[0];
}

export function readChosenProfileId(userId: string): string | null {
  try {
    return localStorage.getItem(storageKey(userId));
  } catch {
    // Storage blocked: the personal profile opens.
    return null;
  }
}

export function saveChosenProfileId(userId: string, profileId: string) {
  try {
    localStorage.setItem(storageKey(userId), profileId);
  } catch {
    // Storage blocked: the choice lasts for this page view.
  }
}
