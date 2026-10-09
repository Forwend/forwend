/** Profile kinds from the API (D-20). */
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

/** Profiles a user can create; the personal one is made at signup. */
export const NEW_PROFILE_KINDS = [PROFILE_KINDS.freelancer, PROFILE_KINDS.merchant] as const;

/** The API's name limit (apps/backend/api/openapi.yaml, CreateProfileRequest.name). */
export const PROFILE_NAME_MAX = 64;

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

/** "Personal", or "Merchant · Shop" when the profile has a name. */
export function profileLabel(profile: Profile): string {
  const kind = PROFILE_KIND_LABELS[profile.kind];
  return profile.name ? `${kind} · ${profile.name}` : kind;
}
