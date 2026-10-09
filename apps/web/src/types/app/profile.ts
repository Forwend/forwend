import type { PROFILE_KINDS } from "@/constants/app";

export type ProfileKind = (typeof PROFILE_KINDS)[keyof typeof PROFILE_KINDS];

/** One profile as the API returns it (apps/backend/api/openapi.yaml, Profile). */
export interface Profile {
  profileId: string;
  kind: ProfileKind;
  name: string | null;
  walletAddress: string | null;
  createdAt: string;
}

/** POST and GET /v1/me. */
export interface Me {
  profiles: Profile[];
}
