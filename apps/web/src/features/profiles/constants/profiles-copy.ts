import { BILLING_LIMITS } from "@/features/profiles/constants/billing-details";
import { PROFILE_KINDS, PROFILE_NAME_MAX } from "@/features/profiles/constants/profile";

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
    name: `Use at most ${PROFILE_NAME_MAX} characters, with no hidden characters. The name can't be Forwend.`,
    cap: "You have the most profiles an account can have.",
    failed: "We could not create the profile. Try again.",
  },
} as const;

export const BILLING_DETAILS_COPY = {
  title: "Billing details",
  saved: "Billing details saved",
  intro:
    "Your name and address as clients see them on each new invoice and its PDF. Invoices you already sent keep the details they had.",
  contactGroup: "Contact",
  addressGroup: "Address and tax",
  name: "Name or business name",
  address: "Address",
  country: "Country",
  countryPlaceholder: "Choose a country",
  searchCountries: "Search countries",
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
    invalid: {
      name: `Use at most ${BILLING_LIMITS.name} characters, with no hidden characters. The name can't be Forwend.`,
      address: `Use at most ${BILLING_LIMITS.address} characters, with no hidden characters.`,
      country: "Choose a country.",
      taxId: `Use at most ${BILLING_LIMITS.taxId} characters, with no hidden characters.`,
      email: "Enter an email like name@example.com.",
    },
  },
} as const;

/** R-80. */
export const NOTIFICATIONS_COPY = {
  title: "Email notifications",
  intro:
    "Get an email when an invoice of this profile is paid, reaches your wallet, or gets money held for the payer.",
  toggle: "Email me about this profile's invoices",
  to: (address: string) => `Emails go to ${address}, the email you sign in with.`,
  noAddress:
    "Your account has no email to send to: you sign in with a passkey alone. Sign in with email or Google to get emails.",
  loadFailed: "We could not load this setting.",
  saveFailed: "We could not save this setting. Try again.",
  retry: "Try again",
  saved: (on: boolean) => (on ? "Email notifications on" : "Email notifications off"),
} as const;
