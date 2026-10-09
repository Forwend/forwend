import { House } from "lucide-react";

/** Signed-in app routes. */
export const APP_ROUTES = {
  site: "/",
  signIn: "/sign-in",
  home: "/app",
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

export const APP_NAV = [{ href: APP_ROUTES.home, label: "Overview", icon: House }] as const;

/** Privy login methods (D-21); each must also be enabled in the Privy dashboard. No wallet login. */
export const LOGIN_METHODS = ["email", "google", "passkey"] as const;

export const APP_COPY = {
  notConfigured: "Sign-in is not set up here: NEXT_PUBLIC_PRIVY_APP_ID is missing.",
  checkingSignIn: "Checking your sign-in",
  loading: "Loading your profiles",
  loadFailed: "We could not load your profiles. Try again, or sign out and sign in again.",
  retry: "Try again",
  signOut: "Sign out",
  profileLabel: "Profile",
  overviewEmptyTitle: "Nothing here yet",
  overviewEmptyBody: "Balances, the receive address and activity for this profile come next.",
} as const;
