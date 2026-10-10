import { PROFILE_KINDS, PROFILE_NAME_MAX } from "@/features/profiles/profile";

export const PROFILES_COPY = {
  newProfile: "New profile",
  profiles: "Profiles",
  switchProfile: "Switch profile",
  profileLabel: "Profile",
} as const;

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
