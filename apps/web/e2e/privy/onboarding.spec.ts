import { expect, type Page, test } from "@playwright/test";
import { sidewaysScroll } from "../sideways";
import { blockingViolations } from "./axe";
import { SETTLED_INVOICE, TRANSFERS } from "./sample-api";
import { session } from "./session";

// First run and checklists (R-50) on a mocked API: a user who has not made the first-run choice yet, with a personal
// profile; POST /v1/me/onboarding adds the profiles the choices need, as the backend does.
const PERSONAL_ID = "33333333-3333-3333-3333-333333333333";
const FREELANCER_ID = "44444444-4444-4444-4444-444444444444";
const MERCHANT_NEW_ID = "55555555-5555-5555-5555-555555555555";
const newProfile = (profileId: string, kind: string) => ({
  profileId,
  kind,
  name: null,
  walletAddress: `0x${profileId.slice(0, 1).repeat(40)}`,
  createdAt: "2026-10-11T00:00:00Z",
});
interface NewUser {
  onboardedAt: string | null;
  profiles: ReturnType<typeof newProfile>[];
  choices: string[][];
  invoices: object[];
  transfers: object[];
  billing: object | null;
}
const newUser = (): NewUser => ({
  onboardedAt: null,
  profiles: [newProfile(PERSONAL_ID, "personal")],
  choices: [],
  invoices: [],
  transfers: [],
  billing: null,
});

async function mockNewUser(page: Page, user: NewUser) {
  await page.route("/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const me = () => ({ onboardedAt: user.onboardedAt, profiles: user.profiles });
    if (path === "/v1/me") return route.fulfill({ json: me() });
    if (path === "/v1/me/onboarding") {
      const { choices } = request.postDataJSON() as { choices: string[] };
      user.choices.push(choices);
      if (user.onboardedAt === null) {
        user.onboardedAt = new Date().toISOString();
        if (choices.includes("get_paid_by_clients")) {
          user.profiles.push(newProfile(FREELANCER_ID, "freelancer"));
        }
        if (choices.some((c) => c === "accept_business_payments" || c === "build_integration")) {
          user.profiles.push(newProfile(MERCHANT_NEW_ID, "merchant"));
        }
      }
      return route.fulfill({ status: 201, json: me() });
    }
    const what = path.split("/").slice(4).join("/");
    if (what === "billing-details") {
      if (request.method() === "PUT") {
        user.billing = { ...request.postDataJSON(), updatedAt: new Date().toISOString() };
      }
      return user.billing
        ? route.fulfill({ json: user.billing })
        : route.fulfill({
            status: 404,
            json: { error: { code: "billing_details_not_found", message: "none" } },
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

const checklist = (page: Page) => page.getByRole("region", { name: "Get started" });
const step = (page: Page, title: string) =>
  checklist(page).getByRole("listitem").filter({ hasText: title });

test("a new user picks what they want to do once and lands on the new profile with its checklist", async ({
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

  // The first run has its own address and title.
  await expect(page).toHaveURL("/app/onboarding?next=%2Fapp");
  await expect(page).toHaveTitle("Forwend | Get started");
  await expect(
    page.getByRole("heading", { level: 1, name: "What do you want to do?" }),
  ).toBeVisible();
  // The first run stands alone: no sidebar until the choice is made.
  await expect(page.locator("aside")).toHaveCount(0);
  const choices = page.getByRole("group", { name: "Uses" });
  await expect(choices.getByRole("checkbox")).toHaveCount(4);
  expect(await blockingViolations(page)).toEqual([]);
  // A card is its checkbox's label: a click anywhere on it toggles it.
  const pick = (title: string) => choices.getByText(title, { exact: true }).click();
  const box = (title: string) => choices.getByRole("checkbox", { name: new RegExp(`^${title}`) });
  await pick("Get paid by clients");
  await pick("Build a payment integration");
  await pick("Build a payment integration");
  await pick("Accept payments for my business");
  await expect(box("Get paid by clients")).toBeChecked();
  await expect(box("Build a payment integration")).not.toBeChecked();
  expect(await blockingViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Continue" }).click();

  // The freelancer profile it made opens, with its checklist computed from the (empty) data.
  const sidebar = page.locator("aside");
  await expect(
    sidebar.getByRole("button", { name: /^Switch profile: (.+ )?Freelancer$/ }),
  ).toBeVisible();
  await expect(page).toHaveURL("/app");
  expect(user.choices).toEqual([["get_paid_by_clients", "accept_business_payments"]]);
  await sidebar.getByRole("button", { name: /^Switch profile/ }).click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(checklist(page).getByRole("listitem")).toHaveCount(5);
  // The passkey step reads the shared Privy test account, which may have a passkey linked.
  await expect(step(page, "Add a passkey")).toContainText(/Done|Add passkey/);
  await expect(
    step(page, "Add billing details").getByRole("link", { name: "Add details" }),
  ).toHaveAttribute("href", "/app/billing-details");
  await expect(
    step(page, "Send your first invoice").getByRole("link", { name: "New invoice" }),
  ).toHaveAttribute("href", "/app/invoices/new");
  await expect(step(page, "Get an invoice paid")).toContainText("Not done");
  expect(await blockingViolations(page)).toEqual([]);

  // Billing details: the step's page saves them, and the step is done from the data.
  await step(page, "Add billing details").getByRole("link", { name: "Add details" }).click();
  await expect(page).toHaveURL("/app/billing-details");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("textbox", { name: "Name or business name" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByRole("alert").filter({ hasText: "Choose a country." })).toBeVisible();
  await page.getByRole("textbox", { name: "Name or business name" }).fill("Ada Design");
  await page.getByRole("textbox", { name: "Address" }).fill("Hauptstr. 1, Berlin");
  await page.getByRole("button", { name: /^Country/ }).click();
  await page.getByRole("combobox", { name: /Country/ }).fill("germany");
  await page.getByRole("option", { name: "Germany" }).click();
  await page.getByRole("textbox", { name: "Contact email" }).fill("ada@example.com");
  expect(await blockingViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page).toHaveURL("/app");
  expect(user.billing).toMatchObject({ name: "Ada Design", country: "DE", taxId: null });
  await expect(step(page, "Add billing details")).toContainText("Done");

  // Made once: a reload goes straight to the app.
  await page.reload();
  await expect(sidebar.getByRole("button", { name: /^Switch profile/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What do you want to do?" })).toHaveCount(0);
  await context.close();
});

test("on a phone a new user skips the first run and gets the personal checklist", async ({
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
    page.getByRole("heading", { level: 1, name: "What do you want to do?" }),
  ).toBeVisible();
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(await blockingViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Skip for now" }).click();

  await expect(checklist(page)).toBeVisible();
  expect(user.choices).toEqual([[]]);
  expect(user.profiles).toHaveLength(1);
  await expect(checklist(page).getByRole("listitem")).toHaveCount(4);
  await expect(step(page, "Add billing details")).toHaveCount(0);
  // A personal profile's first invoice is a request, made on its own page.
  await step(page, "Request money").getByRole("button", { name: "Request", exact: true }).click();
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
  await expect(page).toHaveURL("/app/onboarding?next=%2Fapp%2Finvoices");
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "What do you want to do?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page).toHaveURL("/app/invoices");
  await expect(page.locator("aside")).toBeVisible();

  // Done: the first run's address goes to the overview, also from the back button.
  await page.goto("/app/onboarding");
  await expect(page).toHaveURL("/app");
  await page.goBack();
  await expect(page).not.toHaveURL(/\/app\/onboarding/);
  await context.close();
});

test("the checklist reads its steps from the data, and a skipped step or a closed card stays hidden", async ({
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

  // A paid request: requested and paid are done; money still confirming, or sent out, is not received.
  await expect(step(page, "Request money")).toContainText("Done");
  await expect(step(page, "Get a request paid")).toContainText("Done");
  await expect(step(page, "Request money").getByRole("button")).toHaveCount(0);
  await expect(step(page, "Receive money")).toContainText("Not done");
  // The passkey step reads the shared Privy test account, which may have a passkey linked.
  const passkeyDone =
    (await step(page, "Add a passkey").getByRole("button", { name: "Add passkey" }).count()) === 0;
  await expect(checklist(page)).toContainText(`${passkeyDone ? 3 : 2} of 4 done`);
  await step(page, "Receive money").getByRole("button", { name: "Receive", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /Receive/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Skipping a step hides it on this browser, also after a reload.
  if (!passkeyDone) {
    await step(page, "Add a passkey").getByRole("button", { name: "Skip: Add a passkey" }).click();
    await expect(step(page, "Add a passkey")).toHaveCount(0);
    await page.reload();
    await expect(step(page, "Receive money")).toBeVisible();
    await expect(step(page, "Add a passkey")).toHaveCount(0);
  }

  // Once the money is final the only step left is done, so the card hides.
  user.transfers = [{ ...TRANSFERS[0], direction: "in", status: "confirmed" }];
  await page.reload();
  await expect(page.getByRole("region", { name: "Total balance" })).toBeVisible();
  await expect(checklist(page)).toHaveCount(0);

  // Closing the card hides it for good on this browser.
  user.transfers = [];
  await page.reload();
  await expect(checklist(page)).toBeVisible();
  await checklist(page).getByRole("button", { name: "Close checklist" }).click();
  await expect(checklist(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "Total balance" })).toBeVisible();
  await expect(checklist(page)).toHaveCount(0);
  await context.close();
});
