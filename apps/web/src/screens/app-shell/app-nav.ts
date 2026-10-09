import {
  ArrowLeftRight,
  ChartLine,
  Code,
  FileText,
  LayoutGrid,
  type LucideIcon,
  ShoppingBag,
  WalletCards,
} from "lucide-react";
import { ACTIVITY_COPY } from "@/features/activity/activity-copy";
import { BALANCES_COPY } from "@/features/balances/balances-copy";
import { PROFILE_KINDS, type ProfileKind } from "@/features/profiles/profile";
import { APP_ROUTES } from "@/shared/config/routes";

/** A page in the sidebar and tab bar; href null is a page not built yet, shown as coming. */
export interface NavItem {
  href: string | null;
  label: string;
  icon: LucideIcon;
}

// Pages not built yet are listed as coming, never as links: the owner chose to show what each profile type will have
// (PLAN phases 8-10).
const NAV = {
  overview: { href: APP_ROUTES.home, label: "Overview", icon: LayoutGrid },
  balances: {
    href: APP_ROUTES.balances,
    label: BALANCES_COPY.balancesTitle,
    icon: WalletCards,
  },
  activity: { href: APP_ROUTES.activity, label: ACTIVITY_COPY.activity, icon: ArrowLeftRight },
  invoices: { href: null, label: "Invoices", icon: FileText },
  checkout: { href: null, label: "Checkout", icon: ShoppingBag },
  developers: { href: null, label: "Developers", icon: Code },
  analytics: { href: null, label: "Analytics", icon: ChartLine },
} satisfies Record<string, NavItem>;

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
