import { BILLING_LIMITS } from "@/features/profiles/constants/billing-details";
import { PROFILE_KINDS, PROFILE_NAME_MAX } from "@/features/profiles/constants/profile";

export const PROFILES_COPY = {
  newProfile: "New profile",
  profiles: "Profiles",
  switchProfile: "Switch profile",
  profileLabel: "Profile",
} as const;

export const NEW_PROFILE_COPY = {
  title: "Add a profile",
  intro: "Its own wallet, balances, activity and team. Switch profiles from the sidebar.",
  kindLegend: "What is it for?",
  kinds: {
    [PROFILE_KINDS.freelancer]: {
      hint: "Invoice clients for your work.",
      includes: ["Invoices and quotes", "Clients and reminders", "Your details on every invoice"],
      placeholder: "Mara Ilić Design",
    },
    [PROFILE_KINDS.merchant]: {
      hint: "Take payments from customers.",
      includes: ["Payment links and checkout", "Stores and API keys", "A team with roles"],
      placeholder: "Studio North",
    },
  },
  nameLabel: "Name (optional)",
  create: "Create profile",
  cancel: "Cancel",
  count: (owned: number, max: number) => `${owned} of ${max} profiles`,
  listTitle: "In your profile list",
  newBadge: "New",
  newWallet: (kind: string) => `${kind} · new wallet`,
  gets: [
    { title: "Its own wallet.", text: "A new address, apart from your other profiles." },
    { title: "Its own books.", text: "Balances, activity and clients stay in this profile." },
    { title: "Billing details next.", text: "The setup guide asks for what its invoices print." },
  ],
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
  contactNote: "The name and email clients see on invoices and receipts.",
  addressGroup: "Address and tax",
  addressNote: "Printed under your name on every invoice; EU and UK invoices need a tax ID.",
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
  title: "Accepted assets",
  intro: "The stablecoins and networks new invoices and requests accept. Sent ones keep theirs.",
  lastOn: "One stays on, so this profile can still be paid.",
  loadFailed: "We could not load the accepted assets.",
  saveFailed: "We could not save this setting. Try again.",
  saving: "Saving…",
  savedAll: "Changes saved.",
} as const;

/** R-221. */
/** D-122: who pays new invoices' fees. */
export const FEES_COPY = {
  title: "Network fees",
  note: "Each invoice carries the fee for sending its payment to your wallet. Choose who pays it on new invoices.",
  legend: "Who pays the network fee",
  owner: "You",
  ownerHint:
    "Taken from what you receive when the payment reaches your wallet. Your client pays the price.",
  client: "Your client",
  clientHint: "Added to what your client pays. You receive the full price.",
  kept: "Each invoice and link can choose otherwise. Invoices you already sent keep theirs.",
  ownersOnly: "Only the owner or an Admin can change it.",
  saved: "Saved: new invoices follow it",
  saveFailed: "We could not save who pays the fees. Try again.",
} as const;

export const DEVELOPER_MODE_COPY = {
  title: "Developer mode",
  intro: "Try Forwend on test networks with free testnet tokens before you take real money.",
  section: "Mode",
  sectionNote: "For this profile only: each of your profiles has its own mode.",
  toggle: "Developer mode",
  on: "On: test networks. New invoices, links, keys and webhooks use testnet tokens, which have no value.",
  off: "Off: live networks. Payers pay real stablecoins on Base, Arbitrum, Arc and Tempo.",
  kept: "Turning it changes nothing you already made: each invoice, link, key and webhook keeps its mode.",
  ownersOnly: "Only the owner or an Admin can change it.",
  saveFailed: "We could not change the mode. Try again.",
  noLive: "No live network is switched on yet, so this profile stays in Developer mode.",
  saved: (on: boolean) =>
    on ? "Developer mode on: test networks" : "Developer mode off: live networks",
  strip: "Developer mode: test networks only. Tokens here have no value.",
  stripAction: "Turn off",
  // On a page that found nothing: what it opened may be of the other mode (R-221).
  otherMode: (developer: boolean) =>
    developer
      ? "A live one shows only with Developer mode off."
      : "A test one shows only in Developer mode.",
  switchMode: (developer: boolean) =>
    developer ? "Turn off Developer mode" : "Turn on Developer mode",
} as const;

/** R-80. */
export const NOTIFICATIONS_COPY = {
  emailSection: "Email",
  emailNote:
    "Payment emails for this profile. Payers' receipts and invoices to clients aren't affected.",
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
