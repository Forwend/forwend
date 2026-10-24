import { CLIENTS_COPY } from "@/features/clients/constants/clients-copy";
import { NEW_INVOICE_COPY, NEW_REQUEST_COPY } from "@/features/invoices/constants/invoices-copy";
import { JOBS_COPY } from "@/features/jobs/constants/jobs-copy";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import {
  BILLING_DETAILS_COPY,
  NOTIFICATIONS_COPY,
} from "@/features/profiles/constants/profiles-copy";
import type { ProfileKind } from "@/features/profiles/types/profile";
import { STORES_COPY } from "@/features/stores/constants/stores-copy";
import { APP_NAV, NAV } from "@/screens/app-shell/constants/app-nav";
import type { Crumb } from "@/screens/app-shell/types/app-nav";
import { APP_ROUTES } from "@/shared/config/routes";

export function isCurrentPage(pathname: string, href: string): boolean {
  return pathname === href || (href !== APP_ROUTES.home && pathname.startsWith(`${href}/`));
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
          label: pathname === APP_ROUTES.newClient ? CLIENTS_COPY.newTitle : CLIENTS_COPY.editTitle,
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
          label: pathname === APP_ROUTES.newStore ? STORES_COPY.newTitle : STORES_COPY.editTitle,
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
  const under =
    page.href === APP_ROUTES.invoices ? pathname.slice(`${APP_ROUTES.invoices}/`.length) : "";
  return { trail: [crumb], invoiceId: under && !under.includes("/") ? under : null };
}
