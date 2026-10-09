/** Signed-in app routes. */
export const APP_ROUTES = {
  site: "/",
  signIn: "/sign-in",
  home: "/app",
  newProfile: "/app/profiles/new",
} as const;

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

/** The chains the API may return (packages/contracts/chains.json); every one today is a test network. */
export const CHAINS: Readonly<Record<number, { name: string; testnet: boolean }>> = {
  84532: { name: "Base Sepolia", testnet: true },
  421614: { name: "Arbitrum Sepolia", testnet: true },
  5042002: { name: "Arc Testnet", testnet: true },
  42431: { name: "Tempo Moderato", testnet: true },
  31337: { name: "Anvil (local)", testnet: true },
};

/** How often the overview reads balances and activity again while the tab is visible, in ms. */
export const REFRESH_MS = 15_000;

/** Invoice.paymentStatus values. */
export const API_PAYMENT_STATUSES = {
  open: "open",
  detected: "detected",
  partiallyPaid: "partially_paid",
  paid: "paid",
  expired: "expired",
  expiredPartiallyPaid: "expired_partially_paid",
} as const;

/** Invoice.settlementStatus values. */
export const API_SETTLEMENT_STATUSES = {
  none: "none",
  pending: "pending",
  settled: "settled",
} as const;

/** Deposit.status values. */
export const API_DEPOSIT_STATUSES = {
  detected: "detected",
  confirmed: "confirmed",
} as const;

/** Activity rows: up to this many in one request, the API's limit; "Show more" grows the request by a page. */
export const ACTIVITY_MAX = 100;

export const ACTIVITY_KINDS = {
  invoice: "invoice",
  deposit: "deposit",
} as const;

/** Items per activity page. */
export const ACTIVITY_PAGE_SIZE = 20;

/** Privy login methods (D-21); each must also be enabled in the Privy dashboard. No wallet login. */
export const LOGIN_METHODS = ["email", "google", "passkey"] as const;

export const APP_COPY = {
  notConfigured: "Sign-in is not set up here: NEXT_PUBLIC_PRIVY_APP_ID is missing.",
  checkingSignIn: "Checking your sign-in",
  loading: "Loading your profiles",
  loadFailed: "We could not load your profiles. Try again, or sign out and sign in again.",
  retry: "Try again",
  signOut: "Sign out",
  newProfile: "New profile",
  home: "Forwend home",
  profileLabel: "Profile",
} as const;
