import {
  ArrowLeftRight,
  ChartLine,
  Code,
  FileText,
  HandCoins,
  History,
  LayoutGrid,
  type LucideIcon,
  ShoppingBag,
  WalletCards,
} from "lucide-react";
import { ACTIVITY_COPY } from "@/features/activity/activity-copy";
import { BALANCES_COPY } from "@/features/balances/balances-copy";
import { INVOICES_COPY, NEW_INVOICE_COPY, REQUESTS_COPY } from "@/features/invoices/invoices-copy";
import { PROFILE_KINDS, type ProfileKind } from "@/features/profiles/profile";
import { BILLING_DETAILS_COPY } from "@/features/profiles/profiles-copy";
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

/** The page a path belongs to: the page itself or one under it, such as an invoice under Invoices. */
export function isCurrentPage(pathname: string, href: string): boolean {
  return pathname === href || (href !== APP_ROUTES.home && pathname.startsWith(`${href}/`));
}

export interface Crumb {
  label: string;
  href: string;
}

/**
 * The header's trail after the profile: the page, by the name the profile's sidebar gives it, then a form under it. On
 * an invoice's page the trail ends at Invoices (Requests) and gives the invoice's id, which the header names by its
 * number once the invoice loads.
 */
export function breadcrumb(
  pathname: string,
  kind: ProfileKind,
): { trail: Crumb[]; invoiceId: string | null } {
  if (pathname === APP_ROUTES.newProfile) {
    return { trail: [{ label: "New profile", href: APP_ROUTES.newProfile }], invoiceId: null };
  }
  if (pathname === APP_ROUTES.billingDetails) {
    return {
      trail: [{ label: BILLING_DETAILS_COPY.title, href: APP_ROUTES.billingDetails }],
      invoiceId: null,
    };
  }
  const page =
    APP_NAV[kind]
      .flatMap((group) => group.items)
      .find((item) => item.href && isCurrentPage(pathname, item.href)) ?? NAV.overview;
  const crumb = { label: page.label, href: page.href ?? APP_ROUTES.home };
  if (pathname === APP_ROUTES.newInvoice) {
    return {
      trail: [crumb, { label: NEW_INVOICE_COPY.title, href: APP_ROUTES.newInvoice }],
      invoiceId: null,
    };
  }
  const under =
    page.href === APP_ROUTES.invoices ? pathname.slice(`${APP_ROUTES.invoices}/`.length) : "";
  return { trail: [crumb], invoiceId: under && !under.includes("/") ? under : null };
}
