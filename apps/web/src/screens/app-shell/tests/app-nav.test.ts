import { describe, expect, it } from "vitest";
import type { Profile } from "@/features/profiles/types/profile";
import { APP_NAV } from "@/screens/app-shell/constants/app-nav";
import {
  accountLinks,
  breadcrumb,
  firstPage,
  navFor,
  pageAllowed,
} from "@/screens/app-shell/lib/app-nav";
import { APP_ROUTES } from "@/shared/config/routes";

// As GET /v1/me lists them for a merchant profile's Developer (D-93).
const developer: Profile = {
  profileId: "22222222-2222-2222-2222-222222222222",
  kind: "merchant",
  name: "Shop",
  walletAddress: null,
  createdAt: "2026-10-10T00:00:00Z",
  role: "developer",
  permissions: [
    "invoices.read",
    "invoices.write",
    "stores.read",
    "stores.write",
    "tokens.read",
    "team.leave",
  ],
};

// R-138: the app hides the pages a role can't use; the API refuses them anyway.
describe("navigation by role", () => {
  it("shows a Developer only the pages its permissions reach", () => {
    const pages = navFor(developer).flatMap((group) => group.items.map((item) => item.href));
    expect(pages).toContain(APP_ROUTES.invoices);
    expect(pages).toContain(APP_ROUTES.stores);
    for (const hidden of [
      APP_ROUTES.home,
      APP_ROUTES.balances,
      APP_ROUTES.clients,
      APP_ROUTES.activity,
      // R-145: only the owner and Admins manage API keys (D-95).
      APP_ROUTES.developers,
    ])
      expect(pages).not.toContain(hidden);
  });

  it("sends a page the role can't use to its first page", () => {
    expect(pageAllowed(developer, `${APP_ROUTES.clients}/new`)).toBe(false);
    expect(pageAllowed(developer, APP_ROUTES.billingDetails)).toBe(false);
    expect(pageAllowed(developer, APP_ROUTES.newInvoice)).toBe(true);
    expect(pageAllowed(developer, APP_ROUTES.team)).toBe(true);
    expect(pageAllowed(developer, APP_ROUTES.developers)).toBe(false);
    // Another kind's page is checked too, and a page under one is checked by the most specific.
    expect(pageAllowed(developer, `${APP_ROUTES.jobs}/new`)).toBe(false);
    const finance: Profile = { ...developer, role: "finance", permissions: ["stores.read"] };
    expect(pageAllowed(finance, `${APP_ROUTES.stores}/${developer.profileId}`)).toBe(true);
    expect(pageAllowed(finance, APP_ROUTES.newStore)).toBe(false);
    expect(firstPage(developer)).toBe(APP_ROUTES.payments);
  });

  it("links the team for a merchant profile and the email setting for its owner only", () => {
    expect(accountLinks(developer)).toEqual({ notifications: false, team: true });
    const owner: Profile = {
      ...developer,
      role: "owner",
      permissions: [...developer.permissions, "notifications"],
    };
    expect(accountLinks(owner)).toEqual({ notifications: true, team: true });
    expect(accountLinks({ ...developer, kind: "freelancer" }).team).toBe(false);
  });
});

describe("sidebar names", () => {
  it("never heads a group with the name of a page in it, and gives each page its own icon", () => {
    for (const groups of Object.values(APP_NAV)) {
      for (const group of groups) {
        expect(group.items.map((item) => item.label)).not.toContain(group.label);
      }
      const items = groups.flatMap((group) => group.items);
      expect(new Set(items.map((item) => item.icon)).size).toBe(items.length);
    }
  });
});

describe("breadcrumb", () => {
  it("puts a payment under Payments for every kind of profile", () => {
    const payment = `${APP_ROUTES.payments}/0x${"a".repeat(64)}`;
    const details = { label: "Payment details", href: payment };
    expect(breadcrumb(payment, "merchant")).toEqual({
      trail: [{ label: "Payments", href: APP_ROUTES.payments }, details],
      invoiceId: null,
    });
    expect(breadcrumb(payment, "personal")).toEqual({
      trail: [{ label: "Payments", href: APP_ROUTES.payments }, details],
      invoiceId: null,
    });
  });

  it("names a client's and a store's own page apart from its edit form", () => {
    const last = (path: string) => breadcrumb(path, "merchant").trail.at(-1)?.label;
    const id = "33333333-3333-4333-8333-333333333333";
    expect(last(`${APP_ROUTES.clients}/${id}`)).toBe("Client");
    expect(last(`${APP_ROUTES.clients}/${id}/edit`)).toBe("Edit client");
    expect(last(APP_ROUTES.newClient)).toBe("New client");
    expect(last(`${APP_ROUTES.stores}/${id}`)).toBe("Store");
    expect(last(`${APP_ROUTES.stores}/${id}/edit`)).toBe("Edit store");
    expect(last(APP_ROUTES.newStore)).toBe("New store");
  });
});
