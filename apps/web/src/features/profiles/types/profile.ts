import type { PROFILE_KINDS } from "@/features/profiles/constants/profile";

export type ProfileKind = (typeof PROFILE_KINDS)[keyof typeof PROFILE_KINDS];

/** One profile as the API returns it (apps/backend/api/openapi.yaml, Profile). */
export interface Profile {
  profileId: string;
  kind: ProfileKind;
  name: string | null;
  walletAddress: string | null;
  createdAt: string;
}

/** POST and GET /v1/me, and POST /v1/me/onboarding. */
export interface Me {
  /** When the user made or skipped the first-run choice; null shows it. */
  onboardedAt: string | null;
  profiles: Profile[];
}
