import { PROFILE_KINDS } from "@/constants/app";

/** The API's name limit (apps/backend/api/openapi.yaml, CreateProfileRequest.name). */
export const PROFILE_NAME_MAX = 64;

export const NEW_PROFILE_COPY = {
  title: "New profile",
  intro: "Each profile has its own wallet, balances and activity.",
  kindLegend: "Profile type",
  kindHints: {
    [PROFILE_KINDS.freelancer]: "Get paid by clients.",
    [PROFILE_KINDS.merchant]: "Take payments from customers.",
  },
  nameLabel: "Name (optional)",
  create: "Create profile",
  cancel: "Cancel",
  errors: {
    name: `Use at most ${PROFILE_NAME_MAX} characters.`,
    failed: "We could not create the profile. Try again.",
  },
} as const;
