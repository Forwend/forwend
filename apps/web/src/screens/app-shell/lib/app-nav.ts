import { AUTH_COPY } from "@/features/auth/constants/auth-copy";
import { CLIENTS_COPY } from "@/features/clients/constants/clients-copy";
import { NEW_INVOICE_COPY, NEW_REQUEST_COPY } from "@/features/invoices/constants/invoices-copy";
import { JOBS_COPY } from "@/features/jobs/constants/jobs-copy";
import { LINKS_COPY } from "@/features/links/constants/links-copy";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { can, profileLabel } from "@/features/profiles/lib/profile";
import type { Profile, ProfileKind } from "@/features/profiles/types/profile";
import { STORES_COPY } from "@/features/stores/constants/stores-copy";
import { APP_NAV, MENU_PAGES, NAV, SETTINGS_PAGES } from "@/screens/app-shell/constants/app-nav";
import type { Crumb, NavGroup, NavItem, SettingsPage } from "@/screens/app-shell/types/app-nav";
import { SETTINGS_COPY } from "@/screens/settings/constants/settings-copy";
import { APP_ROUTES } from "@/shared/config/routes";

/** Every settings page, for marking Settings as the current place. */
export const SETTINGS_PATHS: readonly string[] = [
  APP_ROUTES.settings,
  ...SETTINGS_PAGES.map((page) => page.href),
];

export function isCurrentPage(pathname: string, href: string): boolean {
  return pathname === href || (href !== APP_ROUTES.home && pathname.startsWith(`${href}/`));
}

export function navFor(profile: Profile): NavGroup[] {
  return APP_NAV[profile.kind]
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || can(profile, item.permission)),
    }))
    .filter((group) => group.items.length > 0);
}

/** Checks the most specific page holding pathname, of any profile kind; unlisted pages are open. */
export function pageAllowed(profile: Profile, pathname: string): boolean {
  const pages: readonly Pick<NavItem, "href" | "permission">[] = [
    ...Object.values(NAV),
    ...MENU_PAGES,
    ...SETTINGS_PAGES,
  ];
  const page = pages
    .filter((item) => item.href && isCurrentPage(pathname, item.href))
    .sort((a, b) => (b.href?.length ?? 0) - (a.href?.length ?? 0))[0];
  return !page?.permission || can(profile, page.permission);
}

export function settingsGroups(profile: Profile): { label: string; items: SettingsPage[] }[] {
  const pages = SETTINGS_PAGES.filter(
    (page) => pageAllowed(profile, page.href) && (!page.kind || page.kind === profile.kind),
  );
  const own = pages.filter((page) => page.profile);
  return [
    { label: SETTINGS_COPY.yourAccount, items: pages.filter((page) => !page.profile) },
    ...(own.length ? [{ label: profileLabel(profile), items: own }] : []),
  ];
}

/** Where a role lands instead of a page it can't open. */
export function firstPage(profile: Profile): string {
  return (
    navFor(profile)
      .flatMap((group) => group.items)
      .find((item) => item.href)?.href ?? APP_ROUTES.networks
  );
}

/** Pages with no parent in the trail. */
const TOP_PAGES: readonly Crumb[] = [
  { label: "New profile", href: APP_ROUTES.newProfile },
  { label: AUTH_COPY.settings, href: APP_ROUTES.settings },
  // A personal profile reaches it only by its address, and its sidebar has no such page to name it.
  { label: NAV.developers.label, href: NAV.developers.href },
  ...SETTINGS_PAGES,
];

const RECORD_PAGES: readonly {
  list: string;
  create: string;
  names: { create: string; edit?: string; record: string };
}[] = [
  {
    list: APP_ROUTES.clients,
    create: APP_ROUTES.newClient,
    names: {
      create: CLIENTS_COPY.newTitle,
      edit: CLIENTS_COPY.editTitle,
      record: CLIENTS_COPY.detailTitle,
    },
  },
  {
    list: APP_ROUTES.stores,
    create: APP_ROUTES.newStore,
    names: {
      create: STORES_COPY.newTitle,
      edit: STORES_COPY.editTitle,
      record: STORES_COPY.detailTitle,
    },
  },
  {
    list: APP_ROUTES.links,
    create: APP_ROUTES.newLink,
    names: { create: LINKS_COPY.newTitle, edit: LINKS_COPY.editTitle, record: "Payment link" },
  },
  {
    list: APP_ROUTES.jobs,
    create: APP_ROUTES.newJob,
    names: { create: JOBS_COPY.newTitle, record: JOBS_COPY.detailTitle },
  },
];

/** The trail after the profile; on an invoice's page, also the invoice's id to name. */
export function breadcrumb(
  pathname: string,
  kind: ProfileKind,
): { trail: Crumb[]; invoiceId: string | null } {
  const top = TOP_PAGES.find((page) => page.href === pathname);
  if (top) return { trail: [{ label: top.label, href: top.href }], invoiceId: null };
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
  const record = RECORD_PAGES.find((r) => r.list === page.href);
  if (record && pathname !== record.list) {
    const label =
      pathname === record.create
        ? record.names.create
        : (pathname.endsWith("/edit") && record.names.edit) || record.names.record;
    return { trail: [crumb, { label, href: pathname }], invoiceId: null };
  }
  if (pathname.startsWith(`${APP_ROUTES.payments}/`)) {
    return { trail: [crumb, { label: "Payment details", href: pathname }], invoiceId: null };
  }
  const under =
    page.href === APP_ROUTES.invoices ? pathname.slice(`${APP_ROUTES.invoices}/`.length) : "";
  return { trail: [crumb], invoiceId: under && !under.includes("/") ? under : null };
}
