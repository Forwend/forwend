import { API_KEYS_COPY } from "@/features/api-keys/constants/api-keys-copy";
import { AUTH_COPY } from "@/features/auth/constants/auth-copy";
import { CLIENTS_COPY } from "@/features/clients/constants/clients-copy";
import { NEW_INVOICE_COPY, NEW_REQUEST_COPY } from "@/features/invoices/constants/invoices-copy";
import { JOBS_COPY } from "@/features/jobs/constants/jobs-copy";
import { LINKS_COPY } from "@/features/links/constants/links-copy";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import {
  BILLING_DETAILS_COPY,
  NOTIFICATIONS_COPY,
  TOKENS_COPY,
} from "@/features/profiles/constants/profiles-copy";
import { can } from "@/features/profiles/lib/profile";
import type { Profile, ProfileKind } from "@/features/profiles/types/profile";
import { STORES_COPY } from "@/features/stores/constants/stores-copy";
import { TEAM_COPY } from "@/features/team/constants/team-copy";
import { APP_NAV, MENU_PAGES, NAV } from "@/screens/app-shell/constants/app-nav";
import type { Crumb, NavGroup, NavItem } from "@/screens/app-shell/types/app-nav";
import { SETTINGS_COPY } from "@/screens/settings/constants/settings-copy";
import { APP_ROUTES } from "@/shared/config/routes";

/** Every settings page, for marking Settings as the current place. */
export const SETTINGS_PATHS: readonly string[] = [
  APP_ROUTES.settings,
  APP_ROUTES.notifications,
  APP_ROUTES.billingDetails,
  APP_ROUTES.networks,
  APP_ROUTES.team,
  APP_ROUTES.wallet,
];

export function isCurrentPage(pathname: string, href: string): boolean {
  return pathname === href || (href !== APP_ROUTES.home && pathname.startsWith(`${href}/`));
}

/** The profile's sidebar with only the pages its role can use (D-93); a group left empty goes. */
export function navFor(profile: Profile): NavGroup[] {
  return APP_NAV[profile.kind]
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || can(profile, item.permission)),
    }))
    .filter((group) => group.items.length > 0);
}

/** Whether the profile's role can use the page at pathname, by the most specific page that holds it. Every profile
 *  kind's pages count, so another kind's page is checked too; a page no list names is open to every role. */
export function pageAllowed(profile: Profile, pathname: string): boolean {
  const pages: readonly Pick<NavItem, "href" | "permission">[] = [
    ...Object.values(NAV),
    ...MENU_PAGES,
  ];
  const page = pages
    .filter((item) => item.href && isCurrentPage(pathname, item.href))
    .sort((a, b) => (b.href?.length ?? 0) - (a.href?.length ?? 0))[0];
  return !page?.permission || can(profile, page.permission);
}

/** The account menu's pages for the profile: the email setting is the owner's, and only a merchant has a team. */
export function accountLinks(profile: Profile): { notifications: boolean; team: boolean } {
  return {
    notifications: pageAllowed(profile, APP_ROUTES.notifications),
    team: profile.kind === PROFILE_KINDS.merchant && pageAllowed(profile, APP_ROUTES.team),
  };
}

/** Where a role that can't open a page lands instead: the first sidebar page it can use. */
export function firstPage(profile: Profile): string {
  return (
    navFor(profile)
      .flatMap((group) => group.items)
      .find((item) => item.href)?.href ?? APP_ROUTES.networks
  );
}

/** The trail after the profile; on an invoice's page it stops at Invoices and returns the invoice's id to name. */
export function breadcrumb(
  pathname: string,
  kind: ProfileKind,
): { trail: Crumb[]; invoiceId: string | null } {
  if (pathname === APP_ROUTES.newProfile) {
    return { trail: [{ label: "New profile", href: APP_ROUTES.newProfile }], invoiceId: null };
  }
  if (pathname === APP_ROUTES.notifications) {
    return {
      trail: [{ label: NOTIFICATIONS_COPY.title, href: APP_ROUTES.notifications }],
      invoiceId: null,
    };
  }
  if (pathname === APP_ROUTES.settings) {
    return { trail: [{ label: AUTH_COPY.settings, href: APP_ROUTES.settings }], invoiceId: null };
  }
  if (pathname === APP_ROUTES.networks) {
    return { trail: [{ label: TOKENS_COPY.title, href: APP_ROUTES.networks }], invoiceId: null };
  }
  if (pathname === APP_ROUTES.team) {
    return { trail: [{ label: TEAM_COPY.title, href: APP_ROUTES.team }], invoiceId: null };
  }
  // A personal profile reaches it only by its address, and its sidebar has no such page to name it.
  if (pathname === APP_ROUTES.developers) {
    return {
      trail: [{ label: API_KEYS_COPY.title, href: APP_ROUTES.developers }],
      invoiceId: null,
    };
  }
  if (pathname === APP_ROUTES.wallet) {
    return {
      trail: [{ label: SETTINGS_COPY.wallet.title, href: APP_ROUTES.wallet }],
      invoiceId: null,
    };
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
      trail: [
        crumb,
        {
          label: kind === PROFILE_KINDS.personal ? NEW_REQUEST_COPY.title : NEW_INVOICE_COPY.title,
          href: APP_ROUTES.newInvoice,
        },
      ],
      invoiceId: null,
    };
  }
  if (page.href === APP_ROUTES.clients && pathname !== APP_ROUTES.clients) {
    return {
      trail: [
        crumb,
        {
          label:
            pathname === APP_ROUTES.newClient
              ? CLIENTS_COPY.newTitle
              : pathname.endsWith("/edit")
                ? CLIENTS_COPY.editTitle
                : CLIENTS_COPY.detailTitle,
          href: pathname,
        },
      ],
      invoiceId: null,
    };
  }
  if (page.href === APP_ROUTES.stores && pathname !== APP_ROUTES.stores) {
    return {
      trail: [
        crumb,
        {
          label:
            pathname === APP_ROUTES.newStore
              ? STORES_COPY.newTitle
              : pathname.endsWith("/edit")
                ? STORES_COPY.editTitle
                : STORES_COPY.detailTitle,
          href: pathname,
        },
      ],
      invoiceId: null,
    };
  }
  if (page.href === APP_ROUTES.links && pathname !== APP_ROUTES.links) {
    return {
      trail: [
        crumb,
        {
          label:
            pathname === APP_ROUTES.newLink
              ? LINKS_COPY.newTitle
              : pathname.endsWith("/edit")
                ? LINKS_COPY.editTitle
                : "Payment link",
          href: pathname,
        },
      ],
      invoiceId: null,
    };
  }
  if (page.href === APP_ROUTES.jobs && pathname !== APP_ROUTES.jobs) {
    return {
      trail: [
        crumb,
        {
          label: pathname === APP_ROUTES.newJob ? JOBS_COPY.newTitle : JOBS_COPY.detailTitle,
          href: pathname,
        },
      ],
      invoiceId: null,
    };
  }
  if (pathname.startsWith(`${APP_ROUTES.payments}/`)) {
    return { trail: [crumb, { label: "Payment details", href: pathname }], invoiceId: null };
  }
  const under =
    page.href === APP_ROUTES.invoices ? pathname.slice(`${APP_ROUTES.invoices}/`.length) : "";
  return { trail: [crumb], invoiceId: under && !under.includes("/") ? under : null };
}
