import { expect, type Page, test } from "@playwright/test";
import { sidewaysScroll } from "../sideways";
import { blockingViolations } from "./axe";
import { session } from "./session";

// The freelancer profile the job tests share: made once for the test account, with billing details, then reused.
// `open` shows the profile choices: the sidebar menu on desktop, the sheet on phones.
async function chooseFreelancer(page: Page, open: () => Promise<void>) {
  await open();
  const existing = page
    .getByRole("menuitemradio", { name: "Freelancer · E2E studio" })
    .or(page.getByRole("dialog", { name: "Profiles" }).getByRole("button", { name: /E2E studio/ }));
  if (await existing.count()) return existing.click();
  await page.getByRole("menuitem", { name: "New profile" }).click();
  await page.getByText("Freelancer", { exact: true }).click();
  await page.getByRole("textbox", { name: "Name (optional)" }).fill("E2E studio");
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(page).toHaveURL("/app");
}

// New job; a quote names who bills the client, so the shared profile saves its billing details once, first (R-92).
async function openNewJob(page: Page) {
  await page.goto("/app/jobs/new");
  const form = page.getByRole("button", { name: "Create job" });
  const billing = page.getByRole("main").getByRole("link", { name: "Add billing details" });
  await expect(form.or(billing)).toBeVisible();
  if (await billing.isVisible()) {
    await billing.click();
    await page.getByRole("textbox", { name: "Name or business name" }).fill("E2E studio Ltd");
    await page.getByRole("textbox", { name: "Address" }).fill("1 Test Street, Berlin");
    await page.getByRole("button", { name: /^Country/ }).click();
    await page.getByRole("combobox", { name: /Country/ }).fill("germ");
    await page.keyboard.press("Enter");
    await page.getByRole("textbox", { name: "Contact email" }).fill("billing@e2e.example");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page).toHaveURL("/app/jobs/new");
  }
  await expect(form).toBeVisible();
}

// R-101: the job is deleted at the end, so no run leaves one behind toward the profile's 1000 (D-85). One test, which
// starts on a light page and checks the phone width by resizing: every test signs in as one user, whose API rate limit
// the suite comes close to, and switching profile loads the overview.
test("a freelancer writes a quote, opens the job with the client's link, and deletes it; it fits a phone", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: session,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await page.goto("/app/jobs");
  const sidebar = page.locator("aside");
  await chooseFreelancer(page, () =>
    sidebar.getByRole("button", { name: /^Switch profile/ }).click(),
  );
  await expect(
    sidebar.getByRole("button", { name: /^Switch profile: Freelancer · E2E studio/ }),
  ).toBeVisible();
  await sidebar.getByRole("link", { name: "Jobs" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeAttached();
  await expect(page.getByRole("table").or(page.getByText("No jobs yet"))).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  await openNewJob(page);
  // Nothing typed: the first field to fix takes focus, and nothing is sent.
  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toBeFocused();
  const title = `E2E job ${Date.now()}`;
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Scope (optional)" }).fill("A logo in three ideas.");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("E2E client");
  // Resend's test inbox, so an email from a test never reaches a real person.
  await page.getByRole("textbox", { name: "Billing email" }).fill("delivered@resend.dev");
  await page.getByRole("textbox", { name: "Amount in USD of payment 1" }).fill("300");
  await page.getByRole("textbox", { name: "Amount in USD of payment 2" }).fill("700.5");
  await expect(page.getByText("1,000.50 USD", { exact: true })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  const created = page.waitForResponse(
    (r) => /\/api\/v1\/profiles\/[^/]+\/jobs$/.test(r.url()) && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create job" }).click();
  expect((await created).status()).toBe(201);
  await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]{36}$/);

  // The job's page: the payments, how each is invoiced, the total, and the client's link.
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  const payments = page.getByRole("region", { name: "Payments" });
  await expect(payments).toContainText("Deposit");
  await expect(payments).toContainText("Invoiced when the client accepts, due 7 days after");
  await expect(payments).toContainText("Invoiced when you finish this step, due 14 days after");
  await expect(payments.getByText("Not invoiced yet")).toHaveCount(2);
  await expect(payments).toContainText("1,000.50 USD");
  const link = page.getByRole("region", { name: "Client's link" });
  await expect(link).toContainText("Waiting for E2E client to accept.");
  await link.getByRole("button", { name: "Copy link" }).click();
  await expect(link.getByRole("button", { name: "Link copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /^http:\/\/localhost:3000\/w\/[0-9a-f]{64}$/,
  );
  await expect(page.getByRole("region", { name: "Billed to" })).toContainText(
    "delivered@resend.dev",
  );
  await expect(page.getByRole("region", { name: "Scope" })).toContainText("A logo in three ideas.");
  expect(await blockingViolations(page)).toEqual([]);

  // In the list, waiting for acceptance.
  await sidebar.getByRole("link", { name: "Jobs" }).click();
  await page.getByRole("main").getByRole("searchbox", { name: "Search jobs" }).fill(title);
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toContainText("E2E client");
  await expect(row).toContainText("1,000.50 USD");
  await expect(row).toContainText("Waiting for acceptance");
  expect(await blockingViolations(page)).toEqual([]);

  // Deleted before the client accepts, after asking.
  await row.getByRole("link", { name: title }).click();
  await page.getByRole("main").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete job" }).click();
  const dialog = page.getByRole("dialog", { name: `Delete ${title}?` });
  expect(await blockingViolations(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Delete job" }).click();
  await expect(page).toHaveURL("/app/jobs");
  await expect(page.getByText(`${title} deleted`)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: title })).toHaveCount(0);

  // On a phone in the dark theme, Jobs is under More, and the list and New job fit.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  // The shell swaps the sidebar for the tab bar after the resize; until then the old layout is wider than a phone.
  await expect(sidebar).toBeHidden();
  const tabs = page.getByRole("navigation", { name: "Main" });
  await tabs.getByRole("button", { name: "More" }).click();
  await page
    .getByRole("dialog", { name: "More" })
    .getByRole("link", { name: "Jobs", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible();
  await expect.poll(() => sidewaysScroll(page)).toBeLessThanOrEqual(0);
  await page.getByRole("main").getByRole("link", { name: "New job" }).first().click();
  await expect(page.getByRole("button", { name: "Create job" })).toBeVisible();
  await expect.poll(() => sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(await blockingViolations(page)).toEqual([]);
  await context.close();
});
