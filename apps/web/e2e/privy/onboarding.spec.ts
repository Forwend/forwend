import { expect, type Page, test } from "@playwright/test";
import { sidewaysScroll } from "../sideways";
import { blockingViolations } from "./axe";
import { OWNER, SETTLED_INVOICE, TRANSFERS } from "./sample-api";
import { session } from "./session";

// R-50. The mock's POST /v1/me/onboarding adds the profiles the choices need, as the backend does.
const PERSONAL_ID = "33333333-3333-3333-3333-333333333333";
const FREELANCER_ID = "44444444-4444-4444-4444-444444444444";
const MERCHANT_NEW_ID = "55555555-5555-5555-5555-555555555555";
const newProfile = (profileId: string, kind: string, name: string | null = null) => ({
  profileId,
  kind,
  name,
  walletAddress: `0x${profileId.slice(0, 1).repeat(40)}`,
  createdAt: "2026-10-11T00:00:00Z",
  ...OWNER,
});
interface NewUser {
  onboardedAt: string | null;
  profiles: ReturnType<typeof newProfile>[];
  choices: string[][];
  invoices: object[];
  transfers: object[];
  /** Billing details by profile ID. */
  billing: Record<string, object>;
  tokensOff: Record<string, object[]>;
}
const newUser = (): NewUser => ({
  onboardedAt: null,
  profiles: [newProfile(PERSONAL_ID, "personal")],
  choices: [],
  invoices: [],
  transfers: [],
  billing: {},
  tokensOff: {},
});
const TOKENS = [
  {
    chainId: 84532,
    token: `0x${"1".repeat(40)}`,
    symbol: "USDC",
    decimals: 6,
    network: "Base Sepolia",
  },
  {
    chainId: 42431,
    token: `0x${"2".repeat(40)}`,
    symbol: "OUSD",
    decimals: 6,
    network: "Tempo Moderato",
  },
];

async function mockNewUser(page: Page, user: NewUser) {
  await page.route("/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const me = () => ({ onboardedAt: user.onboardedAt, profiles: user.profiles });
    if (path === "/v1/me") return route.fulfill({ json: me() });
    if (path === "/v1/me/onboarding") {
      const { choices, names } = request.postDataJSON() as {
        choices: string[];
        names: Record<string, string>;
      };
      user.choices.push(choices);
      if (user.onboardedAt === null) {
        user.onboardedAt = new Date().toISOString();
        if (choices.includes("get_paid_by_clients")) {
          user.profiles.push(newProfile(FREELANCER_ID, "freelancer", names.freelancer || null));
        }
        if (choices.some((c) => c === "accept_business_payments" || c === "build_integration")) {
          user.profiles.push(newProfile(MERCHANT_NEW_ID, "merchant", names.merchant || null));
        }
      }
      return route.fulfill({ status: 201, json: me() });
    }
    const profileId = path.split("/")[3] ?? "";
    const what = path.split("/").slice(4).join("/");
    if (what === "billing-details") {
      if (request.method() === "PUT") {
        user.billing[profileId] = {
          ...request.postDataJSON(),
          updatedAt: new Date().toISOString(),
        };
      }
      const saved = user.billing[profileId];
      return saved
        ? route.fulfill({ json: saved })
        : route.fulfill({
            status: 404,
            json: { error: { code: "billing_details_not_found", message: "none" } },
          });
    }
    if (what === "tokens") {
      if (request.method() === "PUT") user.tokensOff[profileId] = request.postDataJSON().off;
      const off = (user.tokensOff[profileId] ?? [{ token: TOKENS[1]?.token }]) as {
        token: string;
      }[];
      return route.fulfill({
        json: { tokens: TOKENS.map((t) => ({ ...t, on: !off.some((o) => o.token === t.token) })) },
      });
    }
    const list = (items: object[]) => route.fulfill({ json: { items, nextCursor: null } });
    if (what === "invoices") return list(user.invoices);
    if (what === "transactions") return list(user.transfers);
    if (what === "activity") return list([]);
    if (what === "balances") return route.fulfill({ json: { tokens: [], estimatedUsdTotal: "0" } });
    if (what === "balance-history") return route.fulfill({ json: { points: [], tokens: [] } });
    return route.fulfill({ status: 404, json: {} });
  });
}

// R-50: the setup guide at the sidebar's foot (the phone's More sheet). It starts closed with its progress; its title
// row opens it on the next step, which has its action and Skip.
const checklist = (page: Page) => page.getByRole("region", { name: /^Get started/ });
const openGuide = async (page: Page) => {
  const toggle = checklist(page).getByRole("button", { name: /^Get started/ });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
};
// The passkey step reads the shared Privy test account, which may have a passkey linked: skip it when it is next.
const skipPasskey = async (page: Page) => {
  const skip = checklist(page).getByRole("button", { name: "Skip: Add a passkey" });
  if (await skip.count()) await skip.click();
};

test("a new user picks what they want to do once and lands on the new profile with its setup guide", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  const user = newUser();
  await mockNewUser(page, user);
  await page.goto("/app");

  await expect(page).toHaveURL("/app/onboarding");
  await expect(page).toHaveTitle("Forwend | Get started");
  await expect(
    page.getByRole("heading", { level: 1, name: "What will you use Forwend for?" }),
  ).toBeVisible();
  await expect(page.locator("aside")).toHaveCount(0);
  const choices = page.getByRole("group", { name: "Uses" });
  await expect(choices.getByRole("checkbox")).toHaveCount(4);
  expect(await blockingViolations(page)).toEqual([]);
  const pick = (title: string) => choices.getByText(title, { exact: true }).click();
  const box = (title: string) => choices.getByRole("checkbox", { name: new RegExp(`^${title}`) });
  await pick("Invoice clients");
  await pick("Build with the API");
  await pick("Build with the API");
  await pick("Take payments for my business");
  await expect(box("Invoice clients")).toBeChecked();
  await expect(box("Build with the API")).not.toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();

  // One details step per new profile; the second starts from the first one's contact details.
  await expect(
    page.getByRole("heading", { level: 1, name: "How should clients see you?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("textbox", { name: /^Name on invoices/ })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByRole("textbox", { name: /^Name on invoices/ }).fill("Ada Design");
  await page.getByRole("textbox", { name: /^Contact email/ }).fill("ada@example.com");
  await page.getByRole("textbox", { name: /^Address/ }).fill("Hauptstr. 1, Berlin");
  await page.getByRole("button", { name: /^Country/ }).click();
  await page.getByRole("combobox", { name: /Search countries/ }).fill("germany");
  await page.getByRole("option", { name: "Germany" }).click();
  expect(await blockingViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Tell customers who you are" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Contact email/ })).toHaveValue(
    "ada@example.com",
  );
  await page.getByRole("textbox", { name: /^Business name/ }).fill("Ada Shop");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Where you get paid" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Continue" }).click();
  const notNow = page.getByRole("button", { name: "Not now" });
  await expect(notNow.or(page.getByRole("heading", { level: 1, name: /is ready$/ }))).toBeVisible();
  if (await notNow.isVisible()) await notNow.click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Your freelancer profile is ready" }),
  ).toBeVisible();
  expect(user.choices).toEqual([["get_paid_by_clients", "accept_business_payments"]]);
  expect(user.profiles.map((p) => p.name)).toEqual([null, "Ada Design", "Ada Shop"]);
  expect(user.billing[FREELANCER_ID]).toMatchObject({
    name: "Ada Design",
    country: "DE",
    taxId: null,
  });
  expect(user.billing[MERCHANT_NEW_ID]).toMatchObject({
    name: "Ada Shop",
    email: "ada@example.com",
  });
  expect(await blockingViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Go to overview" }).click();

  const sidebar = page.locator("aside");
  await expect(
    sidebar.getByRole("button", { name: /^Switch profile: (.+ )?Freelancer/ }),
  ).toBeVisible();
  await expect(page).toHaveURL("/app");
  await sidebar.getByRole("button", { name: /^Switch profile/ }).click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(3);
  await page.keyboard.press("Escape");
  // Billing details came from the first run, so the freelancer's guide starts past them.
  await openGuide(page);
  await skipPasskey(page);
  await expect(checklist(page).getByRole("link", { name: "New invoice" })).toHaveAttribute(
    "href",
    "/app/invoices/new",
  );

  await page.reload();
  await expect(sidebar.getByRole("button", { name: /^Switch profile/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What will you use Forwend for?" })).toHaveCount(
    0,
  );
  await context.close();
});

test("on a phone a new user skips the first run and finds the personal setup guide in More", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    storageState: session,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const user = newUser();
  await mockNewUser(page, user);
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { level: 1, name: "What will you use Forwend for?" }),
  ).toBeVisible();
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(await blockingViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Skip setup" }).click();

  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(checklist(page)).toBeVisible();
  expect(user.choices).toEqual([[]]);
  expect(user.profiles).toHaveLength(1);
  // A personal profile has four steps: no billing details.
  await expect(checklist(page)).toContainText(/of 4 done/);
  await openGuide(page);
  await skipPasskey(page);
  await checklist(page).getByRole("button", { name: "Request", exact: true }).click();
  await expect(page).toHaveURL("/app/invoices/new");
  await expect(page.getByRole("heading", { level: 1, name: "Request money" })).toBeAttached();
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(await blockingViolations(page)).toEqual([]);
  await context.close();
});

test("the first run keeps the page a new user asked for, and is closed once done", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: session });
  const page = await context.newPage();
  const user = newUser();
  await mockNewUser(page, user);
  await page.goto("/app/invoices");
  // The address stays clean: the page asked for waits in the tab, through a reload too.
  await expect(page).toHaveURL("/app/onboarding");
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "What will you use Forwend for?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skip setup" }).click();
  await expect(page).toHaveURL("/app/invoices");
  await expect(page.locator("aside")).toBeVisible();

  await page.goto("/app/onboarding");
  await expect(page).toHaveURL("/app");
  await page.goBack();
  await expect(page).not.toHaveURL(/\/app\/onboarding/);
  await context.close();
});

test("the setup guide reads its steps from the data, keeps a skipped step hidden, and goes once all are done", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: session });
  const page = await context.newPage();
  const user = newUser();
  user.onboardedAt = "2026-10-11T00:00:00Z";
  user.invoices = [SETTLED_INVOICE];
  user.transfers = [
    { ...TRANSFERS[1], direction: "in", status: "detected" },
    { ...TRANSFERS[3], direction: "out", status: "confirmed" },
  ];
  await mockNewUser(page, user);
  await page.goto("/app");

  // The request and its payment are done; money in that is not final yet leaves Receive money open.
  await openGuide(page);
  const passkeyDone =
    (await checklist(page).getByRole("button", { name: "Add passkey" }).count()) === 0;
  await expect(checklist(page)).toContainText(`${passkeyDone ? 3 : 2} of 4 done`);
  if (!passkeyDone) {
    await skipPasskey(page);
    await page.reload();
    await openGuide(page);
    await expect(checklist(page).getByRole("button", { name: "Skip: Add a passkey" })).toHaveCount(
      0,
    );
  }
  await expect(checklist(page)).toContainText("Receive money");
  await checklist(page).getByRole("button", { name: "Receive", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /Receive/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // It has no close button: it goes once every step is done or skipped.
  await expect(checklist(page).getByRole("button", { name: /Close/ })).toHaveCount(0);
  user.transfers = [{ ...TRANSFERS[0], direction: "in", status: "confirmed" }];
  await page.reload();
  await expect(page.getByRole("region", { name: "Total balance" })).toBeVisible();
  await expect(checklist(page)).toHaveCount(0);
  await context.close();
});
