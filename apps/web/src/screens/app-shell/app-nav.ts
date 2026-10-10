import {
  ArrowLeftRight,
  ChartLine,
  Code,
  FileText,
  History,
  LayoutGrid,
  type LucideIcon,
  ShoppingBag,
  WalletCards,
} from "lucide-react";
import { ACTIVITY_COPY } from "@/features/activity/activity-copy";
import { BALANCES_COPY } from "@/features/balances/balances-copy";
import { PROFILE_KINDS, type ProfileKind } from "@/features/profiles/profile";
import { TRANSACTIONS_COPY } from "@/features/transactions/transactions-copy";
import { APP_ROUTES } from "@/shared/config/routes";

/** A page in the sidebar; href null is a page not built yet, shown as coming. */
export interface NavItem {
  href: string | null;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

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
  invoices: { href: null, label: "Invoices", icon: FileText },
  checkout: { href: null, label: "Checkout", icon: ShoppingBag },
  developers: { href: null, label: "Developers", icon: Code },
  analytics: { href: null, label: "Analytics", icon: ChartLine },
} satisfies Record<string, NavItem>;

const MONEY: NavGroup = { label: "Money", items: [NAV.overview, NAV.transactions, NAV.balances] };
const INSIGHTS: NavGroup = { label: "Insights", items: [NAV.analytics] };

/** The sidebar's groups for each profile type; invoices, checkout and analytics join as they are built. */
export const APP_NAV: Readonly<Record<ProfileKind, readonly NavGroup[]>> = {
  [PROFILE_KINDS.personal]: [{ ...MONEY, items: [...MONEY.items, NAV.activity] }, INSIGHTS],
  [PROFILE_KINDS.freelancer]: [
    MONEY,
    { label: "Get paid", items: [NAV.invoices, NAV.activity] },
    INSIGHTS,
  ],
  [PROFILE_KINDS.merchant]: [
    MONEY,
    { label: "Payments", items: [NAV.checkout, NAV.activity] },
    { label: "Build", items: [NAV.developers] },
    INSIGHTS,
  ],
};

export function pageLabel(pathname: string): string {
  if (pathname === APP_ROUTES.newProfile) return "New profile";
  return Object.values(NAV).find((item) => item.href === pathname)?.label ?? NAV.overview.label;
}
