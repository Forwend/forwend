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
  group: "Profile",
  nameLabel: "Name (optional)",
  nameHint: "Tells your profiles apart in the profile switcher.",
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
  intro: "How clients see you on new invoices. Sent ones keep theirs.",
  contactGroup: "Contact",
  addressGroup: "Address and tax",
  name: "Name or business name",
  nameHint: "Your own name, or your business's if you invoice as one.",
  businessName: "Business name",
  businessNameHint: "The legal name invoices and receipts show.",
  address: "Address",
  country: "Country",
  countryPlaceholder: "Choose a country",
  searchCountries: "Search countries",
  taxId: "Tax ID (optional)",
  taxIdHint: "A VAT or tax number, if you have one.",
  email: "Contact email",
  save: "Save details",
  cancel: "Cancel",
  loadFailed: "We could not load your billing details.",
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

/** R-136. */
export const TOKENS_COPY = {
  search: "Search tokens",
  searchPlaceholder: "Token or network",
  clearSearch: "Clear search",
  title: "Networks and tokens",
  intro: "What new invoices and requests can be paid in. Sent ones keep theirs.",
  toggle: (symbol: string, network: string) => `${symbol} on ${network}`,
  lastOn: "One token stays on, so this profile can still be paid.",
  loadFailed: "We could not load the networks and tokens.",
  saveFailed: "We could not save this setting. Try again.",
  saved: (symbol: string, network: string, on: boolean) =>
    `${symbol} on ${network} turned ${on ? "on" : "off"}`,
} as const;

/** R-80. */
export const NOTIFICATIONS_COPY = {
  title: "Email notifications",
  intro: "An email when an invoice is paid, reaches your wallet or has money held.",
  toggle: "Email me about this profile's invoices",
  to: (address: string) => `Emails go to ${address}, the email you sign in with.`,
  noAddress:
    "Your account has no email to send to: you sign in with a passkey alone. Sign in with email or Google to get emails.",
  loadFailed: "We could not load this setting.",
  saveFailed: "We could not save this setting. Try again.",
  saved: (on: boolean) => (on ? "Email notifications on" : "Email notifications off"),
} as const;
