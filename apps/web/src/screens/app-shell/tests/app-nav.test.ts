import { describe, expect, it } from "vitest";
import type { Profile } from "@/features/profiles/types/profile";
import { firstPage, navFor, pageAllowed, settingsGroups } from "@/screens/app-shell/lib/app-nav";
import { APP_ROUTES } from "@/shared/config/routes";

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
  livemode: false,
};

const settingsPages = (profile: Profile) =>
  settingsGroups(profile).flatMap((group) => group.items.map((item) => item.href));

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
    expect(pageAllowed(developer, `${APP_ROUTES.jobs}/new`)).toBe(false);
    const finance: Profile = { ...developer, role: "finance", permissions: ["stores.read"] };
    expect(pageAllowed(finance, `${APP_ROUTES.stores}/${developer.profileId}`)).toBe(true);
    expect(pageAllowed(finance, APP_ROUTES.newStore)).toBe(false);
    expect(firstPage(developer)).toBe(APP_ROUTES.payments);
  });

  it("lists the team for a merchant profile and the email setting for its owner only", () => {
    expect(settingsPages(developer)).toContain(APP_ROUTES.team);
    expect(settingsPages(developer)).not.toContain(APP_ROUTES.notifications);
    const owner: Profile = {
      ...developer,
      role: "owner",
      permissions: [...developer.permissions, "notifications"],
    };
    expect(settingsPages(owner)).toContain(APP_ROUTES.notifications);
    expect(settingsPages({ ...developer, kind: "freelancer" })).not.toContain(APP_ROUTES.team);
  });

  it("lists the Wallet page for the owner, who alone moves money, and never for a member", () => {
    const owner: Profile = {
      ...developer,
      role: "owner",
      permissions: ["money.move", "tokens.read"],
    };
    expect(settingsPages(owner)).toContain(APP_ROUTES.wallet);
    const admin: Profile = {
      ...developer,
      role: "admin",
      permissions: ["tokens.read", "team", "team.leave"],
    };
    expect(settingsPages(admin)).not.toContain(APP_ROUTES.wallet);
  });
});
