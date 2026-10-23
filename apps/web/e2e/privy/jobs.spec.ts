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

// New job from the Jobs list, inside the app: a full page load would read the shell's data again, and the suite shares
// one user's API limit. A quote names who bills the client, so the shared profile saves its billing details once,
// first (R-92).
async function openNewJob(page: Page) {
  await page.getByRole("main").getByRole("link", { name: "New job" }).first().click();
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
    sidebar.getByRole("button", { name: /^Switch profile: E2E studio Freelancer/ }),
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
  const quoteLink = await page.evaluate(() => navigator.clipboard.readText());
  expect(quoteLink).toMatch(/^http:\/\/localhost:3000\/w\/[0-9a-f]{64}$/);
  // R-102: the client opens it without an account and reads the real quote. Accepting stays in the mocked public
  // suite: a real accept makes a deposit open 60 days and a job that can't be deleted (D-85).
  const client = await browser.newContext();
  const quote = await client.newPage();
  await quote.goto(quoteLink);
  await expect(quote.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(quote.getByText("Quote from E2E studio Ltd")).toBeVisible();
  await expect(quote.getByRole("region", { name: "Payments" })).toContainText("1,000.50 USD");
  await expect(quote.getByRole("button", { name: "Accept quote" })).toBeVisible();
  expect(await blockingViolations(quote)).toEqual([]);
  await client.close();
  await expect(page.getByRole("region", { name: "Billed to" })).toContainText(
    "delivered@resend.dev",
  );
  await expect(page.getByRole("region", { name: "Scope" })).toContainText("A logo in three ideas.");
  // R-104: the record starts with the quote, at the server's time.
  await expect(page.getByRole("region", { name: "Record" }).getByRole("listitem")).toHaveText([
    /Quote made$/,
  ]);
  expect(await blockingViolations(page)).toEqual([]);

  // In the list, waiting for acceptance.
  await sidebar.getByRole("link", { name: "Jobs" }).click();
  await page.getByRole("main").getByRole("searchbox", { name: "Search jobs" }).fill(title);
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toContainText("E2E client");
  await expect(row).toContainText("1,000.50 USD");
  await expect(row).toContainText("Waiting for acceptance");
  expect(await blockingViolations(page)).toEqual([]);

  // R-103: once accepted, the next step can be marked done. The job reads as accepted here: a real acceptance makes a
  // deposit invoice open 60 days and a job that can't be deleted (D-85). The Go tests cover the real rules.
  const read = /\/api\/v1\/profiles\/[^/]+\/jobs\/[0-9a-f-]{36}$/;
  let changeWaits = true;
  await page.route(read, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        acceptedName: "Jane Doe",
        acceptedEmail: "jane@client.example",
        acceptedAt: new Date().toISOString(),
        payments: [
          {
            ...body.payments[0],
            invoiceId: `0x${"9".repeat(64)}`,
            number: 9001,
            status: "open",
            invoicedAt: new Date().toISOString(),
          },
          body.payments[1],
          // R-106: a scope change waiting for the client, until the step below takes it away.
          ...(changeWaits
            ? [
                {
                  ...body.payments[1],
                  position: 3,
                  title: "Extra page",
                  amountUsd: "150.00",
                  proposedAt: new Date().toISOString(),
                },
              ]
            : []),
        ],
      },
    });
  });
  await row.getByRole("link", { name: title }).click();
  // The page shows the job it read before; it reads it again when the window gets focus, unless a read is under way.
  const readsAgain = (text: string) =>
    expect(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(link).toContainText(text, { timeout: 1000 });
    }).toPass();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await readsAgain("Accepted by Jane Doe");
  await expect(page.getByRole("region", { name: "Record" })).toContainText(
    "Accepted by Jane Doe (jane@client.example)",
  );
  // The waiting change says so, stays out of the total and of Mark done, and can be withdrawn.
  await expect(payments).toContainText("Change · Waiting for the client to accept.");
  await expect(payments).toContainText("1,000.50 USD");
  await expect(payments.getByRole("button", { name: "Withdraw" })).toBeVisible();
  await expect(payments.getByRole("button", { name: "Mark done" })).toHaveCount(0);
  await expect(payments).toContainText("The final invoice waits for the change");
  await expect(payments.getByRole("button", { name: "Propose a change" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Record" })).toContainText(
    "Change proposed: Extra page, 150.00 USD",
  );
  expect(await blockingViolations(page)).toEqual([]);
  const desktop = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebar).toBeHidden();
  await expect.poll(() => sidewaysScroll(page)).toBeLessThanOrEqual(0);
  await page.setViewportSize(desktop);
  await expect(sidebar).toBeVisible();
  // With no change waiting, the owner can propose one. The dialog is checked, not sent: the job isn't really accepted.
  changeWaits = false;
  const proposeButton = payments.getByRole("button", { name: "Propose a change" });
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(proposeButton).toBeVisible({ timeout: 1000 });
  }).toPass();
  await proposeButton.click();
  const propose = page.getByRole("dialog", { name: "Propose a change" });
  await expect(propose.getByRole("textbox", { name: "What the change is for" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  await propose.getByRole("button", { name: "Cancel" }).click();
  await expect(propose).toBeHidden();
  // With no change waiting, the final step can be marked done.
  await payments.getByRole("button", { name: "Mark done" }).click();
  const markDone = page.getByRole("dialog", { name: "Mark Final payment done?" });
  await expect(markDone).toContainText("emailed to delivered@resend.dev");
  await expect(
    markDone.getByRole("textbox", { name: "Link to the delivered work (optional)" }),
  ).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  await markDone.getByRole("button", { name: "Not yet" }).click();
  await expect(markDone).toBeHidden();
  await page.unroute(read);
  await readsAgain("Waiting for E2E client to accept.");
  await page.goBack();

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
