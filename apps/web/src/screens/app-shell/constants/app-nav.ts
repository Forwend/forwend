import {
  ArrowLeftRight,
  BanknoteArrowDown,
  BriefcaseBusiness,
  ChartLine,
  Code,
  FileText,
  HandCoins,
  History,
  LayoutGrid,
  Link2,
  ShoppingBag,
  Store,
  Users,
  WalletCards,
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
import type { Permission, ProfileKind } from "@/features/profiles/types/profile";
import { STORES_COPY } from "@/features/stores/constants/stores-copy";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import type { NavGroup, NavItem } from "@/screens/app-shell/types/app-nav";
import { APP_ROUTES } from "@/shared/config/routes";

// Pages not built yet show as coming, not links: the owner chose to show what each profile will have (PLAN 8-10).
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
    // Money coming in, apart from Transactions' both ways.
    icon: BanknoteArrowDown,
    permission: PERMISSIONS.invoicesRead,
  },
  invoices: {
    href: APP_ROUTES.invoices,
    label: INVOICES_COPY.invoices,
    icon: FileText,
    permission: PERMISSIONS.invoicesRead,
  },
  // A personal profile's invoices are requests (D-52): the same pages under their own name.
  requests: {
    href: APP_ROUTES.invoices,
    label: REQUESTS_COPY.invoices,
    icon: HandCoins,
    permission: PERMISSIONS.invoicesRead,
  },
  // A link is an invoice template, so the invoice permissions reach it (R-140).
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
  // In person: a one-off checkout shown to the customer as a QR code.
  checkout: {
    href: APP_ROUTES.checkout,
    label: CHECKOUT_COPY.title,
    icon: ShoppingBag,
    permission: PERMISSIONS.invoicesWrite,
  },
  // R-145: the profile's secret API keys, for the owner and Admins (D-95).
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
// The heading over what a profile is paid with; not "Payments", which is an item in it.
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

/** The pages outside the sidebar, opened from the account menu and elsewhere, and what each needs (D-93). */
export const MENU_PAGES: readonly { href: string; permission: Permission }[] = [
  { href: APP_ROUTES.newStore, permission: PERMISSIONS.storesWrite },
  { href: APP_ROUTES.billingDetails, permission: PERMISSIONS.billingRead },
  { href: APP_ROUTES.notifications, permission: PERMISSIONS.notifications },
  { href: APP_ROUTES.networks, permission: PERMISSIONS.tokensRead },
  { href: APP_ROUTES.settings, permission: PERMISSIONS.tokensRead },
  // Every member may leave; an Admin also manages the team there.
  { href: APP_ROUTES.team, permission: PERMISSIONS.leave },
];
