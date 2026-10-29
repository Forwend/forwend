import { expect, type Page, test } from "@playwright/test";
import { sidewaysScroll } from "../sideways";
import { blockingViolations } from "./axe";
import { mockApi, OWNER } from "./sample-api";
import { email, session } from "./session";

// R-138, R-139: the API answers are mocked; the Go API tests cover the real ones.
const SHOP = "22222222-2222-2222-2222-222222222222";
const STORE = "66666666-6666-4666-8666-666666666666";
const DEV_ID = "77777777-7777-4777-8777-777777777777";
const OWNER_ID = "88888888-8888-4888-8888-888888888888";
const TOKEN = "cd".repeat(32);
const shop = (role: string, permissions: readonly string[]) => ({
  profileId: SHOP,
  kind: "merchant",
  name: "Sample shop",
  walletAddress: `0x${"7a21".repeat(10)}`,
  createdAt: "2026-09-02T00:00:00Z",
  role,
  permissions,
});
const store = {
  storeId: STORE,
  name: "Pro shop",
  defaultExpiresIn: 3600,
  allowedOrigins: [],
  brandColor: null,
  logoAt: null,
  tokensOff: [],
  updatedAt: "2026-09-02T00:00:00Z",
};

// What the API answers 403 to without the permission (D-93); the app must not ask.
const NEEDS: Record<string, string> = {
  balances: "money.read",
  "balance-history": "money.read",
  activity: "money.read",
  transactions: "money.read",
  "billing-details": "billing.read",
  clients: "clients.read",
  notifications: "notifications",
  jobs: "jobs",
};

/** The team's routes, and /v1/me as the given profile; anything else goes on to mockApi. */
async function mockTeam(page: Page, me: ReturnType<typeof shop>) {
  const team = {
    members: [
      {
        memberId: OWNER_ID,
        email: "owner@example.com",
        role: "owner",
        stores: [],
        createdAt: "2026-09-02T00:00:00Z",
      },
      {
        memberId: DEV_ID,
        email: "dev@example.com",
        role: "developer",
        stores: [STORE],
        createdAt: "2026-09-03T00:00:00Z",
      },
    ],
    invites: [] as object[],
  };
  const sent: { method: string; path: string; body: unknown }[] = [];
  const forbidden: string[] = [];
  await mockApi(page);
  await page.route("/api/v1/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const base = `/v1/profiles/${SHOP}`;
    if (path === "/v1/me") {
      return route.fulfill({ json: { onboardedAt: "2026-09-02T00:00:00Z", profiles: [me] } });
    }
    const need = NEEDS[path.slice(base.length + 1).split("/")[0] ?? ""];
    if (path.startsWith(`${base}/`) && need && !me.permissions.includes(need)) {
      forbidden.push(path);
      return route.fulfill({ status: 403, json: { error: { code: "forbidden", message: "" } } });
    }
    if (path === `${base}/stores`) return route.fulfill({ json: { stores: [store] } });
    if (path === `${base}/members`) return route.fulfill({ json: team });
    if (request.method() === "GET") return route.fallback();
    sent.push({ method: request.method(), path, body: request.postDataJSON() });
    if (path === `${base}/invites`) {
      const invite = {
        inviteId: "99999999-9999-4999-8999-999999999999",
        ...request.postDataJSON(),
        createdAt: "2026-09-04T00:00:00Z",
        expiresAt: "2026-09-11T00:00:00Z",
      };
      team.invites = [invite];
      return route.fulfill({ status: 201, json: invite });
    }
    if (path === `${base}/invites/${"9".repeat(8)}-9999-4999-8999-999999999999`) {
      team.invites = [];
      return route.fulfill({ status: 204 });
    }
    if (path === `${base}/members/${DEV_ID}`) {
      team.members[1] = { ...team.members[1], ...request.postDataJSON() };
      return route.fulfill({ json: team.members[1] });
    }
    return route.fallback();
  });
  return { sent, forbidden };
}

test("a Developer sees only its pages, and lands on Payments", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  const { forbidden } = await mockTeam(
    page,
    shop("developer", [
      "invoices.read",
      "invoices.write",
      "stores.read",
      "stores.write",
      "tokens.read",
      "team.leave",
    ]),
  );
  // The overview reads the balances, which a Developer can't.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app\/payments$/);
  const sidebar = page.locator("aside");
  const nav = sidebar.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "Invoices" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Stores" })).toBeVisible();
  for (const hidden of ["Overview", "My assets", "Transactions", "Clients", "Activity"])
    await expect(nav.getByRole("link", { name: hidden })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Receive", exact: true })).toHaveCount(0);
  await sidebar.getByRole("link", { name: "Invoices", exact: true }).click();
  // Amounts take each token's decimals from the enabled tokens, which every role reads.
  const main = page.getByRole("main");
  await expect(main.getByRole("row", { name: /Logo refresh/ })).toContainText("2.00 USDC");
  await main.getByRole("link", { name: "New invoice" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "New invoice" })).toBeAttached();
  await expect(main.getByRole("textbox", { name: "Amount" })).toBeVisible();
  // A hidden page's address leads to the first page the role can use.
  await page.goto("/app/clients");
  await expect(page).toHaveURL(/\/app\/payments$/);

  await sidebar.getByRole("button", { name: /Account/ }).click();
  await expect(page.getByRole("menuitem", { name: "Email notifications" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Team" }).click();
  await expect(page).toHaveURL(/\/app\/team$/);
  await expect(page.getByText("You are Developer on this profile.")).toBeVisible();
  // Only an Admin manages the team.
  await expect(page.getByRole("heading", { name: "Members" })).toHaveCount(0);
  await page.getByRole("button", { name: "Leave team" }).click();
  await expect(page.getByRole("dialog", { name: "Leave Merchant · Sample shop?" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  // Nothing the role can't read was asked for, not even by a poll.
  expect(forbidden).toEqual([]);
  await context.close();
});

test("an Admin invites, changes a role and revokes an invite on the Team page", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  const { sent } = await mockTeam(page, shop("owner", OWNER.permissions));
  await page.goto("/app/team");
  const main = page.getByRole("main");
  await expect(main.getByText("dev@example.com", { exact: true })).toBeVisible();
  await expect(
    main
      .getByRole("row")
      .filter({ hasText: "dev@example.com" })
      .getByRole("cell", { name: "Pro shop", exact: true }),
  ).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  await main.getByRole("button", { name: "Invite" }).click();
  const invite = page.getByRole("dialog", { name: "Invite to the team" });
  await invite.getByRole("textbox", { name: "Email" }).fill("new@example.com");
  await invite.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: "Finance" }).click();
  await invite.getByRole("button", { name: "Send invite" }).click();
  await expect(invite.getByRole("alert")).toHaveText("Choose at least one store.");
  expect(sent).toEqual([]);
  await invite.getByRole("checkbox", { name: "Pro shop" }).check();
  expect(await blockingViolations(page)).toEqual([]);
  await invite.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invite sent to new@example.com")).toBeVisible();
  await expect(invite).toBeHidden();
  expect(sent.at(-1)).toEqual({
    method: "POST",
    path: `/v1/profiles/${SHOP}/invites`,
    body: { email: "new@example.com", role: "finance", stores: [STORE] },
  });

  await main.getByRole("button", { name: "Actions for dev@example.com" }).click();
  await page.getByRole("menuitem", { name: "Change role" }).click();
  const change = page.getByRole("dialog", { name: "Change the role of dev@example.com" });
  await change.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: "Admin" }).click();
  await change.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("dev@example.com is now Admin")).toBeVisible();
  // Opened again, the form starts from the saved role.
  await main.getByRole("button", { name: "Actions for dev@example.com" }).click();
  await page.getByRole("menuitem", { name: "Change role" }).click();
  await expect(change.getByRole("combobox", { name: "Role" })).toHaveText("Admin");
  await change.getByRole("button", { name: "Cancel" }).click();
  expect(sent.at(-1)).toEqual({
    method: "PUT",
    path: `/v1/profiles/${SHOP}/members/${DEV_ID}`,
    body: { role: "admin", stores: [] },
  });

  await main.getByRole("button", { name: "Revoke the invite to new@example.com" }).click();
  await expect(page.getByText("Invite to new@example.com revoked")).toBeVisible();
  await expect(main.getByText("No open invites.")).toBeVisible();
  await context.close();
});

test("the invite link accepts for the invited address, fits a phone and says when it is gone", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockTeam(page, shop("developer", ["invoices.read", "team.leave"]));
  let invited = "someone-else@example.com";
  let accepts = 0;
  await page.route(`/api/v1/invites/${TOKEN}`, (route) =>
    route.fulfill({
      json: {
        profileName: "Sample shop",
        email: invited,
        role: "developer",
        expiresAt: "2099-01-01T00:00:00Z",
      },
    }),
  );
  await page.route(`/api/v1/invites/${TOKEN}/accept`, (route) => {
    accepts++;
    return route.fulfill({ json: { profileId: SHOP } });
  });

  await page.goto(`/invite/${TOKEN}`);
  await expect(page.getByRole("heading", { level: 1, name: "Join Sample shop" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "This invite is for someone-else@example.com. Sign out, then sign in with that address.",
  );
  await expect(page.getByRole("button", { name: "Accept invite" })).toHaveCount(0);
  expect(await blockingViolations(page)).toEqual([]);
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);

  invited = email.toLowerCase();
  await page.reload();
  await page.getByRole("button", { name: "Accept invite" }).click();
  await expect(page).toHaveURL(/\/app\/payments$/);
  expect(accepts).toBe(1);

  await page.unroute(`/api/v1/invites/${TOKEN}`);
  await page.route(`/api/v1/invites/${TOKEN}`, (route) =>
    route.fulfill({ status: 404, json: { error: { code: "invite_not_found", message: "" } } }),
  );
  await page.goto(`/invite/${TOKEN}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "This invite link no longer works" }),
  ).toBeVisible();
  await context.close();
});
