/** Signed-in app routes. */
import type { BrandIconName } from "@forwend/ui-web";
import {
  ArrowLeftRight,
  ChartLine,
  Code,
  FileText,
  LayoutGrid,
  ShoppingBag,
  WalletCards,
} from "lucide-react";
import type { NavItem } from "@/types/app/nav";
import type { ProfileKind } from "@/types/app/profile";
import { PROFILE_PAGE_COPY } from "./profile-page";

export const APP_ROUTES = {
  site: "/",
  signIn: "/sign-in",
  home: "/app",
  balances: "/app/balances",
  activity: "/app/activity",
  newProfile: "/app/profiles/new",
} as const;

/** The width where the sidebar replaces the phone header and tab bar (Tailwind's lg). */
export const DESKTOP_QUERY = "(min-width: 64rem)";

/** The phone tab bar's Receive: the dashboard opens its sheet on this event, or on this hash after navigating there. */
export const RECEIVE_EVENT = "forwend:receive";
export const RECEIVE_HASH = "#receive";

// Pages not built yet are listed as coming, never as links: the owner chose to show what each profile type will have
// (PLAN phases 8-10).
const NAV = {
  overview: { href: APP_ROUTES.home, label: "Overview", icon: LayoutGrid },
  balances: {
    href: APP_ROUTES.balances,
    label: PROFILE_PAGE_COPY.balancesTitle,
    icon: WalletCards,
  },
  activity: { href: APP_ROUTES.activity, label: PROFILE_PAGE_COPY.activity, icon: ArrowLeftRight },
  invoices: { href: null, label: "Invoices", icon: FileText },
  checkout: { href: null, label: "Checkout", icon: ShoppingBag },
  developers: { href: null, label: "Developers", icon: Code },
  analytics: { href: null, label: "Analytics", icon: ChartLine },
} satisfies Record<string, NavItem>;

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

/** The sidebar and tab bar pages for each profile type; invoices, checkout and analytics join as they are built. */
export const APP_NAV: Readonly<Record<ProfileKind, readonly NavItem[]>> = {
  [PROFILE_KINDS.personal]: [NAV.overview, NAV.balances, NAV.activity, NAV.analytics],
  [PROFILE_KINDS.freelancer]: [
    NAV.overview,
    NAV.invoices,
    NAV.balances,
    NAV.activity,
    NAV.analytics,
  ],
  [PROFILE_KINDS.merchant]: [
    NAV.overview,
    NAV.checkout,
    NAV.balances,
    NAV.activity,
    NAV.developers,
    NAV.analytics,
  ],
};

/** Profiles a user can create; the personal one is made at signup. */
export const NEW_PROFILE_KINDS = [PROFILE_KINDS.freelancer, PROFILE_KINDS.merchant] as const;

/** The chains the API may return (packages/contracts/chains.json); every one today is a test network. */
export const CHAINS: Readonly<
  Record<number, { name: string; testnet: boolean; icon?: BrandIconName }>
> = {
  84532: { name: "Base Sepolia", testnet: true, icon: "base" },
  421614: { name: "Arbitrum Sepolia", testnet: true, icon: "arbitrum" },
  5042002: { name: "Arc Testnet", testnet: true, icon: "arc" },
  42431: { name: "Tempo Moderato", testnet: true, icon: "tempo" },
  31337: { name: "Anvil (local)", testnet: true },
};

/** Token logos by symbol. */
export const TOKEN_ICONS: Readonly<Record<string, BrandIconName>> = { USDC: "usdc", USDT: "usdt" };

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
  profiles: "Profiles",
  switchProfile: "Switch profile",
  account: "Account",
  theme: "Theme",
  light: "Light",
  dark: "Dark",
  signedIn: "Signed in",
  mainNav: "Main",
  soon: "Soon",
  settings: "Settings",
  walletNotReady: "Wallet not ready",
  profileLabel: "Profile",
} as const;
