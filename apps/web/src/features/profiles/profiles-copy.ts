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

export const BILLING_DETAILS_COPY = {
  title: "Billing details",
  saved: "Billing details saved",
  intro:
    "Your name and address as clients see them on each new invoice and its PDF. Invoices you already sent keep the details they had.",
  name: "Name or business name",
  address: "Address",
  country: "Country",
  countryPlaceholder: "Choose a country",
  taxId: "Tax ID (optional)",
  email: "Contact email",
  save: "Save details",
  cancel: "Cancel",
  loadFailed: "We could not load your billing details.",
  retry: "Try again",
  errors: {
    required: "Fill in this field.",
    country: "Choose a country.",
    email: "Enter an email like name@example.com.",
    failed: "We could not save your billing details. Check them and try again.",
  },
} as const;
