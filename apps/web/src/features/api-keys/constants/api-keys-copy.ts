import type { OVERLAP_HOURS } from "@/features/api-keys/constants/api-keys";
import type { KeyScope } from "@/features/api-keys/types/api-keys";
import { PERMISSIONS } from "@/features/profiles/constants/profile";

// After a roll two keys share a name, so the end of the text tells them apart.
const keyText = (last4: string, livemode: boolean) =>
  `${livemode ? "fw_live_" : "fw_test_"}…${last4}`;

/** R-145: the Developers page's API keys. */
export const API_KEYS_COPY = {
  title: "Developers",
  intro: "Keys for your server. Never put one in a web page or an app.",
  notPersonal: "A personal profile has no API keys. A freelancer or merchant profile makes them.",
  keys: "API keys",
  profileId: "Profile ID",
  profileIdHint: "The API's routes name it: /v1/profiles/{profileId}/…",
  copyProfileId: "Copy the profile ID",
  docs: "Read the API docs",
  testMode: "Test mode",
  keyText,
  lastUsed: (when: string) => `Last used ${when}`,
  neverUsed: "Never used",
  never: "Never",
  columns: {
    name: "Name",
    key: "Key",
    store: "Store",
    access: "Access",
    lastUsed: "Last used",
    actions: "Actions",
  },
  stops: (when: string) => `Stops ${when}`,
  empty: "No API keys yet",
  emptyBody: "Make one to create invoices from your own code.",
  loadFailed: "We could not load your API keys.",
  add: "New key",
  newTitle: "New API key",
  name: "Name",
  nameHint: "Where it runs, like Production server.",
  store: "Store",
  scopes: "What it can do",
  scopesHint: "No key can move money.",
  scopeLabels: {
    [PERMISSIONS.invoicesRead]: "Read invoices",
    [PERMISSIONS.invoicesWrite]: "Create and change invoices",
    [PERMISSIONS.storesRead]: "Read stores",
    [PERMISSIONS.tokensRead]: "Read accepted assets",
  } satisfies Record<KeyScope, string>,
  make: "Make key",
  cancel: "Cancel",
  secretTitle: "Copy your key now",
  secretBody:
    "This is the only time it shows. Keep it secret: anyone who has it can act for this profile.",
  secretLabel: "Secret key",
  secretHint: "Store it in your server's secrets, not in your code.",
  copyLabel: "Copy the secret key",
  done: "Done",
  actions: (name: string, last4: string, livemode: boolean) =>
    `Actions for ${name}, ${keyText(last4, livemode)}`,
  roll: "Roll",
  rollTitle: (name: string, last4: string, livemode: boolean) =>
    `Roll ${name}, ${keyText(last4, livemode)}`,
  rollBody:
    "A new key takes its place with the same access. The old one keeps working for the time you pick, so you can swap it without downtime.",
  overlap: "The old key keeps working",
  overlapLabels: {
    0: "Stops now",
    1: "For 1 hour",
    24: "For 24 hours",
    168: "For 7 days",
  } satisfies Record<(typeof OVERLAP_HOURS)[number], string>,
  rollSubmit: "Roll key",
  revoke: "Revoke",
  revokeTitle: (name: string, last4: string, livemode: boolean) =>
    `Revoke ${name}, ${keyText(last4, livemode)}?`,
  revokeBody: "It stops working at once, and requests that use it start failing.",
  keep: "Keep",
  revoked: (name: string) => `${name} revoked`,
  errors: {
    name: "Enter a name of up to 100 characters.",
    scopes: "Pick at least one.",
    failed: "Could not save. Try again.",
    revokeFailed: "Could not revoke the key. Try again.",
  },
} as const;
