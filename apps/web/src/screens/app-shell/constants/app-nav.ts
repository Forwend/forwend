import {
  ArrowLeftRight,
  BanknoteArrowDown,
  Bell,
  BriefcaseBusiness,
  ChartLine,
  Code,
  Coins,
  FileText,
  FlaskConical,
  HandCoins,
  History,
  Landmark,
  LayoutGrid,
  Link2,
  ShieldCheck,
  ShoppingBag,
  Store,
  Users,
  WalletCards,
  WalletMinimal,
} from "lucide-react";
import { ACTIVITY_COPY } from "@/features/activity/constants/activity-copy";
import { API_KEYS_COPY } from "@/features/api-keys/constants/api-keys-copy";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { CHECKOUT_COPY } from "@/features/checkout/constants/checkout-copy";
import { CLIENTS_COPY } from "@/features/clients/constants/clients-copy";
import { INVOICES_COPY, REQUESTS_COPY } from "@/features/invoices/constants/invoices-copy";
import { JOBS_COPY } from "@/features/jobs/constants/jobs-copy";
import { LINKS_COPY } from "@/features/links/constants/links-copy";
import { PAYMENTS_COPY } from "@/features/payments/constants/payments-copy";
import { PERMISSIONS, PROFILE_KINDS } from "@/features/profiles/constants/profile";
import {
  BILLING_DETAILS_COPY,
  DEVELOPER_MODE_COPY,
  NOTIFICATIONS_COPY,
  TOKENS_COPY,
} from "@/features/profiles/constants/profiles-copy";
import type { Permission, ProfileKind } from "@/features/profiles/types/profile";
import { STORES_COPY } from "@/features/stores/constants/stores-copy";
import { TEAM_COPY } from "@/features/team/constants/team-copy";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import type { NavGroup, NavItem, SettingsPage } from "@/screens/app-shell/types/app-nav";
import { SETTINGS_COPY } from "@/screens/settings/constants/settings-copy";
import { APP_ROUTES } from "@/shared/config/routes";

export const NAV = {
  overview: {
    href: APP_ROUTES.home,
    label: "Overview",
    icon: LayoutGrid,
    permission: PERMISSIONS.moneyRead,
  },
  transactions: {
    href: APP_ROUTES.transactions,
    label: TRANSACTIONS_COPY.transactions,
    icon: ArrowLeftRight,
    permission: PERMISSIONS.moneyRead,
  },
  balances: {
    href: APP_ROUTES.balances,
    label: BALANCES_COPY.balancesTitle,
    icon: WalletCards,
    permission: PERMISSIONS.moneyRead,
  },
  activity: {
    href: APP_ROUTES.activity,
    label: ACTIVITY_COPY.activity,
    icon: History,
    permission: PERMISSIONS.moneyRead,
  },
  payments: {
    href: APP_ROUTES.payments,
    label: PAYMENTS_COPY.title,
    icon: BanknoteArrowDown,
    permission: PERMISSIONS.invoicesRead,
  },
  invoices: {
    href: APP_ROUTES.invoices,
    label: INVOICES_COPY.invoices,
    icon: FileText,
    permission: PERMISSIONS.invoicesRead,
  },
  requests: {
    href: APP_ROUTES.invoices, // a personal profile's invoices
    label: REQUESTS_COPY.invoices,
    icon: HandCoins,
    permission: PERMISSIONS.invoicesRead,
  },
  links: {
    href: APP_ROUTES.links,
    label: LINKS_COPY.title,
    icon: Link2,
    permission: PERMISSIONS.invoicesRead,
  },
  clients: {
    href: APP_ROUTES.clients,
    label: CLIENTS_COPY.title,
    icon: Users,
    permission: PERMISSIONS.clientsRead,
  },
  jobs: {
    href: APP_ROUTES.jobs,
    label: JOBS_COPY.title,
    icon: BriefcaseBusiness,
    permission: PERMISSIONS.jobs,
  },
  stores: {
    href: APP_ROUTES.stores,
    label: STORES_COPY.title,
    icon: Store,
    permission: PERMISSIONS.storesRead,
  },
  checkout: {
    href: APP_ROUTES.checkout,
    label: CHECKOUT_COPY.title,
    icon: ShoppingBag,
    permission: PERMISSIONS.invoicesWrite,
  },
  developers: {
    href: APP_ROUTES.developers,
    label: API_KEYS_COPY.title,
    icon: Code,
    permission: PERMISSIONS.keys,
  },
  analytics: { href: null, label: "Analytics", icon: ChartLine },
} satisfies Record<string, NavItem>;

const MONEY: NavGroup = { label: "Money", items: [NAV.overview, NAV.transactions, NAV.balances] };
const INSIGHTS: NavGroup = { label: "Insights", items: [NAV.analytics] };
const GET_PAID = "Get paid";

export const APP_NAV: Readonly<Record<ProfileKind, readonly NavGroup[]>> = {
  [PROFILE_KINDS.personal]: [
    { ...MONEY, items: [...MONEY.items, NAV.payments, NAV.requests, NAV.activity] },
    INSIGHTS,
  ],
  [PROFILE_KINDS.freelancer]: [
    MONEY,
    {
      label: GET_PAID,
      items: [NAV.payments, NAV.invoices, NAV.links, NAV.jobs, NAV.clients, NAV.activity],
    },
    { label: "Build", items: [NAV.developers] },
    INSIGHTS,
  ],
  [PROFILE_KINDS.merchant]: [
    MONEY,
    {
      label: GET_PAID,
      items: [
        NAV.payments,
        NAV.invoices,
        NAV.links,
        NAV.clients,
        NAV.stores,
        NAV.checkout,
        NAV.activity,
      ],
    },
    { label: "Build", items: [NAV.developers] },
    INSIGHTS,
  ],
};

/** The settings pages in menu order: the person's own, then the active profile's. */
export const SETTINGS_PAGES: readonly SettingsPage[] = [
  {
    href: APP_ROUTES.account,
    label: SETTINGS_COPY.account.title,
    icon: ShieldCheck,
    permission: PERMISSIONS.tokensRead,
    profile: false,
  },
  {
    href: APP_ROUTES.notifications,
    label: NOTIFICATIONS_COPY.title,
    icon: Bell,
    permission: PERMISSIONS.notifications,
    profile: false,
  },
  {
    href: APP_ROUTES.billingDetails,
    label: BILLING_DETAILS_COPY.title,
    icon: Landmark,
    permission: PERMISSIONS.billingRead,
    profile: true,
  },
  {
    href: APP_ROUTES.networks,
    label: TOKENS_COPY.title,
    icon: Coins,
    permission: PERMISSIONS.tokensRead,
    profile: true,
  },
  {
    href: APP_ROUTES.developerMode,
    label: DEVELOPER_MODE_COPY.title,
    icon: FlaskConical,
    permission: PERMISSIONS.tokensRead,
    profile: true,
  },
  {
    href: APP_ROUTES.team,
    label: TEAM_COPY.title,
    icon: Users,
    permission: PERMISSIONS.leave, // every member may leave
    profile: true,
    kind: PROFILE_KINDS.merchant,
  },
  {
    href: APP_ROUTES.wallet,
    label: SETTINGS_COPY.wallet.title,
    icon: WalletMinimal,
    permission: PERMISSIONS.moneyMove, // owner only: the key moves the money
    profile: true,
  },
];

/** Pages outside the sidebar, opened from the account menu and elsewhere. */
export const MENU_PAGES: readonly { href: string; permission: Permission }[] = [
  { href: APP_ROUTES.newStore, permission: PERMISSIONS.storesWrite },
  { href: APP_ROUTES.settings, permission: PERMISSIONS.tokensRead },
];
