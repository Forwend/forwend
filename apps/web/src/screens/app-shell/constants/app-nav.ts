import {
  ArrowLeftRight,
  ChartLine,
  Code,
  FileText,
  HandCoins,
  History,
  LayoutGrid,
  ShoppingBag,
  WalletCards,
} from "lucide-react";
import { ACTIVITY_COPY } from "@/features/activity/constants/activity-copy";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { INVOICES_COPY, REQUESTS_COPY } from "@/features/invoices/constants/invoices-copy";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import type { ProfileKind } from "@/features/profiles/types/profile";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import type { NavGroup, NavItem } from "@/screens/app-shell/types/app-nav";
import { APP_ROUTES } from "@/shared/config/routes";

// Pages not built yet are listed as coming, never as links: the owner chose to show what each profile type will have
// (PLAN phases 8-10).
export const NAV = {
  overview: { href: APP_ROUTES.home, label: "Overview", icon: LayoutGrid },
  transactions: {
    href: APP_ROUTES.transactions,
    label: TRANSACTIONS_COPY.transactions,
    icon: ArrowLeftRight,
  },
  balances: { href: APP_ROUTES.balances, label: BALANCES_COPY.balancesTitle, icon: WalletCards },
  activity: { href: APP_ROUTES.activity, label: ACTIVITY_COPY.activity, icon: History },
  invoices: { href: APP_ROUTES.invoices, label: INVOICES_COPY.invoices, icon: FileText },
  // A personal profile's invoices are requests (D-52): the same pages under their own name.
  requests: { href: APP_ROUTES.invoices, label: REQUESTS_COPY.invoices, icon: HandCoins },
  checkout: { href: null, label: "Checkout", icon: ShoppingBag },
  developers: { href: null, label: "Developers", icon: Code },
  analytics: { href: null, label: "Analytics", icon: ChartLine },
} satisfies Record<string, NavItem>;

const MONEY: NavGroup = { label: "Money", items: [NAV.overview, NAV.transactions, NAV.balances] };
const INSIGHTS: NavGroup = { label: "Insights", items: [NAV.analytics] };

/** The sidebar's groups for each profile type; checkout and analytics join as they are built. */
export const APP_NAV: Readonly<Record<ProfileKind, readonly NavGroup[]>> = {
  [PROFILE_KINDS.personal]: [
    { ...MONEY, items: [...MONEY.items, NAV.requests, NAV.activity] },
    INSIGHTS,
  ],
  [PROFILE_KINDS.freelancer]: [
    MONEY,
    { label: "Get paid", items: [NAV.invoices, NAV.activity] },
    INSIGHTS,
  ],
  [PROFILE_KINDS.merchant]: [
    MONEY,
    { label: "Payments", items: [NAV.invoices, NAV.checkout, NAV.activity] },
    { label: "Build", items: [NAV.developers] },
    INSIGHTS,
  ],
};
