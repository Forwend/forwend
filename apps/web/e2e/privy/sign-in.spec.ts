import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

const { PRIVY_TEST_EMAIL: email = "", PRIVY_TEST_OTP: code = "" } = parseEnv(
  readFileSync(".env", "utf8"),
) as Record<string, string>;

async function blockingViolations(page: Page) {
  // Colors are read after any opening fade (sheets, menus) has finished; endless loops (spinners) are not waited on.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY)
        // A menu closing mid-wait cancels its animation; that is not a failure.
        .map((a) => a.finished.catch(() => {})),
    ),
  );
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

async function signIn(page: Page) {
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  // The code step, before typing: axe checks it too.
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  // A pasted code with a space signs in without pressing the button.
  await page.getByRole("textbox", { name: "Code" }).fill(`${code.slice(0, 3)} ${code.slice(3)}`);
}

// Privy throttles a test account that signs in many times in a row, so the tests that only need to be signed in
// share one session made here; the sign-in test itself signs in on its own.
let session: Awaited<ReturnType<BrowserContext["storageState"]>>;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page);
  await expect(page).toHaveURL("/app", { timeout: 30_000 });
  session = await context.storageState();
  await context.close();
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`/sign-in has no serious or critical axe violations in the ${colorScheme} theme`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/sign-in");
    await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);
    await context.close();
  });
}

test("a wrong email address is named before any code is sent", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email" }).fill("not-an-email");
  await page.getByRole("button", { name: "Email me a code" }).click();
  // Announced, and the form keeps its place.
  const before = await page.getByRole("button", { name: "Continue with Google" }).boundingBox();
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter an email like name@example.com." }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(await page.getByRole("button", { name: "Continue with Google" }).boundingBox()).toEqual(
    before,
  );
  expect(await blockingViolations(page)).toEqual([]);
});

test("a wrong code is named on the code field, with no other error", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  const wrong = code === "000000" ? "111111" : "000000";
  await page.getByRole("textbox", { name: "Code" }).fill(wrong);
  await expect(page.getByRole("alert").filter({ hasText: "Wrong or expired code." })).toBeVisible();
  await expect(page.getByText("Google sign-in did not finish")).toHaveCount(0);
  expect(await blockingViolations(page)).toEqual([]);
});

test("a cancelled passkey prompt is named, and the other ways to sign in stay usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  // The browser's passkey prompt, cancelled by the user.
  await page.addInitScript(() => {
    const prompts = window as unknown as { passkeyPrompts: number };
    prompts.passkeyPrompts = 0;
    navigator.credentials.get = () => {
      prompts.passkeyPrompts++;
      return Promise.reject(new DOMException("The operation was cancelled.", "NotAllowedError"));
    };
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Passkey sign-in did not finish." }),
  ).toBeVisible();
  // The error came from the passkey prompt itself, not from Privy failing before it.
  expect(
    await page.evaluate(() => (window as unknown as { passkeyPrompts: number }).passkeyPrompts),
  ).toBe(1);
  await expect(page).toHaveURL("/sign-in");
  // One line even on a narrow phone, so the message never moves the centered form.
  expect(
    (await page.getByRole("alert").filter({ hasText: /./ }).boundingBox())?.height,
  ).toBeLessThanOrEqual(24);
  await expect(page.getByRole("button", { name: "Sign in with passkey" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Email me a code" })).toBeEnabled();
  expect(await blockingViolations(page)).toEqual([]);
});

test("a signed-out visit to /app goes to sign-in", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in to Forwend" })).toBeVisible();
});

test("the Privy test account signs in and lands in the app shell with its personal profile", async ({
  page,
}) => {
  await page.goto("/sign-in");
  // The real sign-in page, with Privy ready on its allowed origin.
  await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  const signedUp = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/me") && r.request().method() === "POST",
  );
  await signIn(page);
  await expect(page).toHaveURL("/app", { timeout: 30_000 });
  // The account signed up on an earlier run, so this is the repeat call: 200 with the same profile (201 the first
  // time). The backend tests cover the first signup.
  expect([200, 201]).toContain((await signedUp).status());

  // The shell: the profile switcher on top of the sidebar, the pages, the account at the bottom.
  const sidebar = page.locator("aside");
  await expect(sidebar.getByRole("button", { name: /^Switch profile: Personal/ })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(sidebar.getByRole("link", { name: "Balances" })).toBeVisible();
  // Pages not built yet are listed as coming, not as links.
  await expect(sidebar.getByText("Analytics")).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Analytics" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Personal overview" })).toBeAttached();
  await expect(page.getByRole("region", { name: "Total balance" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  // The header: where you are, search, notifications and the money actions.
  const header = page.getByRole("banner");
  await expect(
    header.getByRole("navigation", { name: "Breadcrumb" }).getByText("Overview"),
  ).toBeVisible();
  await expect(header.getByRole("button", { name: /^Send/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await header.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("menu").getByText("Notifications")).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  // ⌘K opens search over pages, profiles and transactions; Enter opens the chosen one.
  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByRole("dialog", { name: "Search" });
  await expect(search).toBeVisible();
  await search.getByRole("combobox").fill("balances");
  expect(await blockingViolations(page)).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Balances" })).toBeVisible();
  await sidebar.getByRole("link", { name: "Overview", exact: true }).click();

  // The one theme control is in the account menu, as on phones; the sidebar has none.
  await expect(sidebar.getByRole("switch")).toHaveCount(0);
  const theme = await page.locator("html").getAttribute("data-theme");
  await sidebar.getByRole("button", { name: /^Account: / }).click();
  await expect(page.getByRole("menuitem", { name: /^Settings/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.getByRole("menuitemcheckbox", { name: "Dark mode" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", theme ?? "");
  await page.keyboard.press("Escape");
  // The overview passes axe in the other theme too.
  expect(await blockingViolations(page)).toEqual([]);

  // Signing in again finds the same single personal profile.
  await page.reload();
  await sidebar.getByRole("button", { name: /^Switch profile/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "Personal" })).toHaveCount(1);
  await page.keyboard.press("Escape");

  // When the api fails, the user can retry or sign out, never stuck in the app.
  await page.route("**/api/v1/me", (route) => route.fulfill({ status: 500 }));
  await page.reload();
  // Next.js adds its own route announcer alert; pick ours by its text.
  await expect(
    page.getByRole("alert").filter({ hasText: "We could not load your profiles" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/sign-in");
  await page.unroute("**/api/v1/me");
  await page.goto("/app");
  await expect(page).toHaveURL("/sign-in");
});

test("a profile shows its balance, networks, receive address and activity; a new profile gets its own wallet", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: session });
  const page = await context.newPage();
  await page.goto("/app");
  const sidebar = page.locator("aside");

  // Balance: the USD total marked as an estimate, and the four actions where only Receive works today. With no
  // network enabled in this database, the card says so instead.
  const balance = page.getByRole("region", { name: "Total balance" });
  const inWallet = balance.getByRole("button", {
    name: /^Estimated: each stablecoin counts as 1 USD/,
  });
  await expect(inWallet.or(balance.getByText("No networks are enabled yet."))).toBeVisible();
  for (const action of ["Send", "Transfer", "Withdraw"]) {
    await expect(balance.getByRole("button", { name: new RegExp(`^${action}`) })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  }
  // The balance over time, from GET balance-history, with its ranges; or a reason it cannot be drawn.
  await expect(
    balance
      .getByRole("img", { name: /^Balance over the past month/ })
      .or(balance.getByText("The history shows once every balance can be read.")),
  ).toBeVisible();
  await balance.getByText("1W", { exact: true }).click();
  await expect(balance.getByRole("radio", { name: "1W" })).toBeChecked();
  await expect(page.getByRole("region", { name: "Balances by network" })).toBeVisible();
  const recent = page.getByRole("region", { name: "Recent transactions" });
  await expect(
    recent
      .getByText("No transactions yet. Money sent to or from this profile's wallet shows here.")
      .or(recent.getByRole("table")),
  ).toBeVisible();

  // Receive: a sheet with the QR code, the full address in one box and a warning naming one exact network and token.
  const address = page.getByRole("dialog", { name: "Receive" }).locator("p", { hasText: /^0x/ });
  const readAddress = async () => {
    // The header's Receive works on every profile and page.
    await page.getByRole("banner").getByRole("button", { name: "Receive", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Receive" });
    await expect(
      sheet.getByRole("img", { name: "QR code of this profile's receive address" }),
    ).toBeVisible();
    await expect(address).toHaveText(/^0x([0-9a-f]{4}){10}$/);
    await expect(sheet.getByRole("note")).toContainText(/Send only \S+ on .+\./);
    expect(await blockingViolations(page)).toEqual([]);
    const text = await address.textContent();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    return text;
  };
  if (await inWallet.isVisible()) {
    const personalWallet = await readAddress();

    // A merchant profile, made once for the test account (each one gets a real Privy wallet), then reused.
    await sidebar.getByRole("button", { name: /^Switch profile/ }).click();
    const existing = page.getByRole("menuitemradio", { name: "Merchant · E2E shop" });
    if (await existing.count()) {
      await existing.click();
    } else {
      await page.getByRole("menuitem", { name: "New profile" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "New profile" })).toBeVisible();
      expect(await blockingViolations(page)).toEqual([]);
      await page.getByText("Merchant", { exact: true }).click();
      await page.getByRole("textbox", { name: "Name (optional)" }).fill("E2E shop");
      await page.getByRole("button", { name: "Create profile" }).click();
      await expect(page).toHaveURL("/app");
    }
    await expect(
      sidebar.getByRole("button", { name: /^Switch profile: Merchant · E2E shop/ }),
    ).toBeVisible();
    // A merchant's sidebar lists its own coming pages, and its overview is a business console.
    await expect(sidebar.getByText("Checkout")).toBeVisible();
    await expect(sidebar.getByText("Developers")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Merchant · E2E shop overview" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Received" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Payments" })).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);
    // Its own wallet: not the personal profile's address.
    expect(await readAddress()).not.toBe(personalWallet);
  }

  // The other pages of the profile.
  await sidebar.getByRole("link", { name: "Balances" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Balances" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  // Switching profile on a page other than the dashboard keeps that page.
  await sidebar.getByRole("button", { name: /^Switch profile/ }).click();
  await page.getByRole("menuitemradio", { name: "Personal" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Balances" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^Switch profile: Personal/ })).toBeVisible();
  await sidebar.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  await sidebar.getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Direction" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  await context.close();
});

test("on a phone the app is a banking-style home with a tab bar", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    storageState: session,
  });
  const page = await context.newPage();
  await page.goto("/app");
  await expect(page.locator("aside")).toBeHidden();
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => document.scrollingElement?.scrollWidth)).toBe(390);
  // Round money actions under the centered total; Receive opens the sheet.
  await page
    .getByRole("region", { name: "Total balance" })
    .getByRole("button", { name: "Receive", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Receive" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await blockingViolations(page)).toEqual([]);
  // The switcher opens as a bottom sheet with the profiles to choose from, from the tab bar.
  await tabs.getByRole("button", { name: "Profiles" }).click();
  const profilesSheet = page.getByRole("dialog", { name: "Profiles" });
  await expect(profilesSheet.getByRole("button", { name: "Personal" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(profilesSheet.getByRole("link", { name: "New profile" })).toBeVisible();
  await page.keyboard.press("Escape");
  // The account opens from the top bar; on phones it carries the one dark-mode switch.
  await page
    .getByRole("banner")
    .getByRole("button", { name: /^Account: / })
    .click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Dark mode" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  // Menus are not modal: the page behind stays readable while one is open.
  expect(await blockingViolations(page)).toEqual([]);
  // The switch flips the theme and the menu stays open; the phone home passes axe in that theme too.
  const theme = await page.locator("html").getAttribute("data-theme");
  await page.getByRole("menuitemcheckbox", { name: "Dark mode" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", theme ?? "");
  await page.keyboard.press("Escape");
  expect(await blockingViolations(page)).toEqual([]);

  // A tablet turned to landscape while the profile sheet is open: the sheet closes, the page stays usable.
  await page.setViewportSize({ width: 800, height: 1100 });
  await tabs.getByRole("button", { name: "Profiles" }).click();
  await expect(page.getByRole("dialog", { name: "Profiles" })).toBeVisible();
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.getByRole("dialog", { name: "Profiles" })).toBeHidden();
  await page.locator("aside").getByRole("link", { name: "Balances" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Balances" })).toBeVisible();
  await context.close();
});

// The merchant profile the tests share: made once for the test account (each one gets a real Privy wallet), then
// reused. `open` shows the profile choices: the sidebar menu on desktop, the sheet on phones.
async function chooseMerchant(page: Page, open: () => Promise<void>) {
  await open();
  const existing = page
    .getByRole("menuitemradio", { name: "Merchant · E2E shop" })
    .or(page.getByRole("dialog", { name: "Profiles" }).getByRole("button", { name: /E2E shop/ }));
  if (await existing.count()) return existing.click();
  await page.getByRole("menuitem", { name: "New profile" }).click();
  await page.getByText("Merchant", { exact: true }).click();
  await page.getByRole("textbox", { name: "Name (optional)" }).fill("E2E shop");
  await page.getByRole("button", { name: "Create profile" }).click();
  await expect(page).toHaveURL("/app");
}

// Creates an invoice and returns its number, or null when this database has no enabled network: the page then says so
// instead of showing the form.
async function createInvoice(page: Page, fill: () => Promise<void>) {
  await expect(page.getByRole("heading", { level: 1, name: "New invoice" })).toBeVisible();
  const noNetworks = page.getByText("No networks are enabled yet");
  await expect(
    noNetworks.or(page.getByRole("combobox", { name: "Network and token" })),
  ).toBeVisible();
  if (await noNetworks.isVisible()) {
    expect(await blockingViolations(page)).toEqual([]);
    return null;
  }
  await fill();
  const created = page.waitForResponse(
    (r) => /\/api\/v1\/profiles\/[^/]+\/invoices$/.test(r.url()) && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create invoice" }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const { invoiceId, number } = (await response.json()) as { invoiceId: string; number: number };
  await expect(page).toHaveURL(`/app/invoices/${invoiceId}`);
  return { invoiceId, number: `INV-${String(number).padStart(4, "0")}` };
}

test("a merchant creates an invoice, finds it in the list and opens its detail with the pay link", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: session,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await page.goto("/app");
  const sidebar = page.locator("aside");
  await chooseMerchant(page, () =>
    sidebar.getByRole("button", { name: /^Switch profile/ }).click(),
  );
  await expect(
    sidebar.getByRole("button", { name: /^Switch profile: Merchant · E2E shop/ }),
  ).toBeVisible();

  // Invoices is a page now, not "Soon".
  await sidebar.getByRole("link", { name: "Invoices" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Invoices" })).toBeVisible();
  await expect(page.getByRole("table").or(page.getByText("No invoices yet"))).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  // The chosen profile survives a reload and opens in a new tab: switcher and merchant nav.
  const isMerchant = async (p: Page) => {
    const aside = p.locator("aside");
    await expect(
      aside.getByRole("button", { name: /^Switch profile: Merchant · E2E shop/ }),
    ).toBeVisible();
    await expect(aside.getByText("Checkout")).toBeVisible();
    await expect(p.getByRole("heading", { level: 1, name: "Invoices" })).toBeAttached();
  };
  await page.reload();
  await isMerchant(page);
  const tab = await context.newPage();
  await tab.goto("/app/invoices");
  await isMerchant(tab);
  await tab.close();
  await page.getByRole("link", { name: "New invoice" }).first().click();

  const title = `E2E ${Date.now()}`;
  const invoice = await createInvoice(page, async () => {
    // An amount the token can't hold is named on the field before anything is sent.
    const amount = page.getByRole("textbox", { name: "Amount" });
    await amount.fill("1.1234567");
    await page.getByRole("button", { name: "Create invoice" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /has 6 decimals/ })).toBeVisible();
    await expect(amount).toHaveAttribute("aria-invalid", "true");
    await expect(amount).toBeFocused();
    expect(await blockingViolations(page)).toEqual([]);
    await amount.fill("12.5");
    await page.getByRole("textbox", { name: "Title (optional)" }).fill(title);
    await page.getByRole("textbox", { name: "Note to the client (optional)" }).fill("Thank you");
    await page.getByLabel("Due date (optional)").fill("2026-12-01");
    await page.getByText("1 day", { exact: true }).click();
    await expect(page.getByRole("radio", { name: "1 day" })).toBeChecked();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("E2E client");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("client@example.com");
    await page.getByRole("textbox", { name: "Address" }).fill("1 Test Street\nBerlin");
  });
  if (invoice) {
    // The detail: number, amount in the token, the timeline, due date apart from the checkout's close, the client.
    // Nothing paid yet: the first step is the current one.
    await expect(page.getByRole("heading", { level: 1, name: invoice.number })).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();
    const amount = page.getByRole("region", { name: "Amount" });
    await expect(amount).toContainText("12.50 USDC");
    await expect(amount.getByRole("list", { name: "Payment progress" })).toContainText(
      /Detected.*Confirming.*Paid.*Settled/,
    );
    await expect(amount.getByRole("listitem").filter({ hasText: "Detected" })).toHaveAttribute(
      "aria-current",
      "step",
    );
    // No status pill: the timeline carries the status, and no payment has come in yet.
    await expect(amount.locator("[data-status]")).toHaveCount(0);
    const details = page.getByRole("region", { name: "Details" });
    await expect(details).toContainText("Due date");
    await expect(details).toContainText("Dec 1, 2026");
    await expect(details).toContainText("Checkout closes");
    const client = page.getByRole("region", { name: "Client" });
    await expect(client).toContainText("E2E client");
    await expect(client).toContainText("client@example.com");
    // The pay link copies whole.
    const link = `http://localhost:3000/pay/${invoice.invoiceId}`;
    const share = page.getByRole("region", { name: "Pay link" });
    await expect(share).toContainText(link);
    await share.getByRole("button", { name: "Copy link" }).click();
    await expect(share.getByRole("button", { name: "Link copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    // The PDFs come through the same-origin /api path; the receipt only once the invoice is paid.
    const pdf = (name: string) => details.getByRole("link", { name });
    const read = `/api/v1/invoices/${invoice.invoiceId}`;
    const pdfPath = (file: string) => `${read}/${file}`;
    await expect(pdf("Invoice PDF")).toHaveAttribute("href", pdfPath("invoice.pdf"));
    const file = await page.request.get(pdfPath("invoice.pdf"));
    expect([file.status(), file.headers()["content-type"]]).toEqual([200, "application/pdf"]);
    await expect(pdf("Receipt PDF")).toHaveCount(0);
    expect(await blockingViolations(page)).toEqual([]);
    await page.route(`**${read}`, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), paymentStatus: "paid" },
      });
    });
    await page.reload();
    await expect(pdf("Receipt PDF")).toHaveAttribute("href", pdfPath("receipt.pdf"));
    await page.unroute(`**${read}`);

    // Back in the list, newest first.
    await page.getByRole("link", { name: "Invoices" }).first().click();
    const row = page.getByRole("row").filter({ hasText: invoice.number });
    await expect(row).toContainText(title);
    await expect(row).toContainText("E2E client");
    await expect(row).toContainText("Dec 1, 2026");
    await expect(row).toContainText("12.50 USDC");
    await expect(row).toContainText("Waiting for payment");
    await row.getByRole("link", { name: invoice.number }).click();
    await expect(page.getByRole("heading", { level: 1, name: invoice.number })).toBeVisible();
  }
  await context.close();
});

test("on a phone a merchant creates and opens an invoice without sideways scrolling", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    colorScheme: "dark",
    storageState: session,
  });
  const page = await context.newPage();
  const fits = async () =>
    expect(await page.evaluate(() => document.scrollingElement?.scrollWidth)).toBe(390);
  await page.goto("/app");
  await chooseMerchant(page, () =>
    page
      .getByRole("navigation", { name: "Main" })
      .getByRole("button", { name: "Profiles" })
      .click(),
  );
  // Phones reach Invoices from search.
  await page.getByRole("banner").getByRole("button", { name: "Search" }).click();
  await page.getByRole("dialog", { name: "Search" }).getByRole("combobox").fill("invoices");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Invoices" })).toBeVisible();
  await fits();
  await page.getByRole("link", { name: "New invoice" }).first().click();
  const invoice = await createInvoice(page, async () => {
    await fits();
    await page.getByRole("textbox", { name: "Amount" }).fill("1");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("E2E phone client");
  });
  if (invoice) {
    await expect(page.getByRole("heading", { level: 1, name: invoice.number })).toBeVisible();
    await expect(page.getByRole("region", { name: "Amount" })).toContainText("1.00 USDC");
    await fits();
    expect(await blockingViolations(page)).toEqual([]);
    await page.getByRole("link", { name: "Invoices" }).click();
    await expect(page.getByRole("link", { name: new RegExp(`^${invoice.number}`) })).toBeVisible();
    await fits();
    expect(await blockingViolations(page)).toEqual([]);
  }
  await context.close();
});

// Opens Request money from the round actions on the personal overview and waits for the form; false when this database
// has no enabled network: the sheet then says so.
async function openRequest(page: Page) {
  await page
    .getByRole("region", { name: "Total balance" })
    .getByRole("button", { name: "Request", exact: true })
    .click();
  const sheet = page.getByRole("dialog", { name: "Request money" });
  const noNetworks = sheet.getByText("No networks are enabled yet");
  await expect(
    noNetworks.or(sheet.getByRole("combobox", { name: "Network and token" })),
  ).toBeVisible();
  if (await noNetworks.isVisible()) {
    expect(await blockingViolations(page)).toEqual([]);
    return false;
  }
  return true;
}

// Creates the filled-in request through the API and returns its id and number (INV-0001).
async function createRequest(page: Page) {
  const created = page.waitForResponse(
    (r) => /\/api\/v1\/profiles\/[^/]+\/invoices$/.test(r.url()) && r.request().method() === "POST",
  );
  await page
    .getByRole("dialog", { name: "Request money" })
    .getByRole("button", { name: "Create request" })
    .click();
  const response = await created;
  expect(response.status()).toBe(201);
  const { invoiceId, number } = (await response.json()) as { invoiceId: string; number: number };
  return { invoiceId, number: `INV-${String(number).padStart(4, "0")}` };
}

test("a personal profile requests money, sends the pay link and the payer sees who asks (R-49)", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: session,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await page.goto("/app");
  const sidebar = page.locator("aside");
  await expect(sidebar.getByRole("button", { name: /^Switch profile: Personal/ })).toBeVisible();
  // ⌘K offers it as an action.
  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByRole("dialog", { name: "Search" });
  await search.getByRole("combobox").fill("request");
  await expect(search.getByRole("option", { name: /^Request money/ })).toBeVisible();
  await page.keyboard.press("Escape");

  if (await openRequest(page)) {
    const sheet = page.getByRole("dialog", { name: "Request money" });
    // The name the payer sees is required, and named on its field before anything is sent.
    const name = sheet.getByRole("textbox", { name: "Your name (shown to the payer)" });
    await name.fill("");
    await sheet.getByRole("textbox", { name: "Amount" }).fill("3.25");
    await sheet.getByRole("button", { name: "Create request" }).click();
    await expect(
      sheet.getByRole("alert").filter({ hasText: "Enter the name the payer will see." }),
    ).toBeVisible();
    await expect(name).toBeFocused();
    await name.fill("E2E Requester");
    const note = `E2E lunch ${Date.now()}`;
    await sheet.getByRole("textbox", { name: "Note to the payer (optional)" }).fill(note);
    await sheet.getByText("1 day", { exact: true }).click();
    await expect(sheet.getByRole("radio", { name: "1 day" })).toBeChecked();
    expect(await blockingViolations(page)).toEqual([]);
    const request = await createRequest(page);

    // The link to send, right away, and it copies whole.
    await expect(sheet.getByText("Request created")).toBeVisible();
    await expect(sheet).toContainText("3.25 USDC");
    const link = `http://localhost:3000/pay/${request.invoiceId}`;
    const share = sheet.getByRole("region", { name: "Pay link" });
    await expect(share).toContainText(link);
    await share.getByRole("button", { name: "Copy link" }).click();
    await expect(share.getByRole("button", { name: "Link copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    expect(await blockingViolations(page)).toEqual([]);

    // Its detail sits under Requests and names who asks.
    await sheet.getByRole("link", { name: "View request" }).click();
    await expect(page).toHaveURL(`/app/invoices/${request.invoiceId}`);
    await expect(sheet).toBeHidden();
    await expect(
      page
        .getByRole("navigation", { name: "Breadcrumb" })
        .getByRole("link", { name: "Requests", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "From" })).toContainText("E2E Requester");
    await expect(page.getByRole("region", { name: "Client" })).toHaveCount(0);
    expect(await blockingViolations(page)).toEqual([]);
    await sidebar.getByRole("link", { name: "Requests" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeAttached();
    await expect(page.getByRole("link", { name: new RegExp(`^${request.number}`) })).toContainText(
      note,
    );
    expect(await blockingViolations(page)).toEqual([]);

    // The payer, without an account, sees the name and the amount asked.
    const payer = await browser.newContext({ reducedMotion: "reduce" });
    const pay = await payer.newPage();
    await pay.goto(`/pay/${request.invoiceId}`);
    await expect(
      pay.getByRole("heading", { level: 1, name: "E2E Requester requests 3.25 USDC" }),
    ).toBeVisible();
    await expect(pay.getByText(`Request ${request.number}`)).toBeVisible();
    await expect(pay.getByText("The sender gave no name")).toHaveCount(0);
    expect(await blockingViolations(pay)).toEqual([]);
    await payer.close();
  }
  await context.close();
});

test("on a phone a personal profile requests money from the round actions without sideways scrolling", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    colorScheme: "dark",
    storageState: session,
  });
  const page = await context.newPage();
  const fits = async () =>
    expect(await page.evaluate(() => document.scrollingElement?.scrollWidth)).toBe(390);
  await page.goto("/app");
  await fits();
  if (await openRequest(page)) {
    const sheet = page.getByRole("dialog", { name: "Request money" });
    await sheet.getByRole("textbox", { name: "Amount" }).fill("1");
    await sheet.getByRole("textbox", { name: "Your name (shown to the payer)" }).fill("E2E Phone");
    const request = await createRequest(page);
    await expect(sheet.getByRole("region", { name: "Pay link" })).toContainText(
      `/pay/${request.invoiceId}`,
    );
    await fits();
    expect(await blockingViolations(page)).toEqual([]);
    await sheet.getByRole("link", { name: "View request" }).click();
    await expect(page.getByRole("heading", { level: 1, name: request.number })).toBeVisible();
    await expect(page.getByRole("link", { name: "Requests" })).toBeVisible();
    await fits();

    await page.goto(`/pay/${request.invoiceId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "E2E Phone requests 1.00 USDC" }),
    ).toBeVisible();
    await fits();
    expect(await blockingViolations(page)).toEqual([]);
  }
  await context.close();
});

// The app pages on sample data: the API is mocked, so the rows, statuses and transactions are known. One merchant
// profile with four invoices, the payments to two of them, and transfers on Base Sepolia.
const MERCHANT_ID = "22222222-2222-2222-2222-222222222222";
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const hash = (c: string) => `0x${c.repeat(64)}`;
const NOW = Date.now();
const sampleInvoice = (
  number: number,
  paymentStatus: string,
  settlementStatus: string,
  title: string | null,
  client: string | null,
) => ({
  invoiceId: `0x${String(number).padStart(4, "0")}${"a".repeat(60)}`,
  number,
  title,
  note: null,
  dueDate: null,
  client: { name: client, email: null, address: null },
  issuer: null,
  chainId: 84532,
  token: USDC,
  amount: `${number}000000`,
  recipient: `0x${"7a21".repeat(10)}`,
  receiveAddress: `0x${"c".repeat(40)}`,
  expiresAt: new Date(NOW + 86_400_000).toISOString(),
  settleDeadline: new Date(NOW + 2 * 86_400_000).toISOString(),
  paymentStatus,
  settlementStatus,
  settlementTxHash: settlementStatus === "settled" ? hash("f") : null,
  createdAt: new Date(NOW - number * 3_600_000).toISOString(),
});
const CONFIRMING_INVOICE = sampleInvoice(4, "detected", "none", "Brand site", "Brightline Studio");
const SETTLED_INVOICE = sampleInvoice(3, "paid", "settled", "October retainer", "Kettle & Co.");
const OPEN_INVOICE = sampleInvoice(2, "open", "none", "Logo refresh", "Mara Ilić");
const INVOICES = [
  CONFIRMING_INVOICE,
  SETTLED_INVOICE,
  OPEN_INVOICE,
  sampleInvoice(1, "expired", "none", null, null),
];
const sampleDeposit = (inv: typeof CONFIRMING_INVOICE, status: string, blocksLeft: number) => ({
  txHash: hash(status === "detected" ? "d" : "e"),
  logIndex: 0,
  from: `0x${"c".repeat(40)}`,
  amount: inv.amount,
  blockNumber: 1000,
  blockTime: "2026-10-09T08:30:00Z",
  status,
  late: false,
  blocksLeft,
  secondsLeft: blocksLeft * 3,
});
const DEPOSITS: Record<string, object[]> = {
  [CONFIRMING_INVOICE.invoiceId]: [sampleDeposit(CONFIRMING_INVOICE, "detected", 120)],
  [SETTLED_INVOICE.invoiceId]: [sampleDeposit(SETTLED_INVOICE, "confirmed", 0)],
};
const activityItem = (
  inv: typeof CONFIRMING_INVOICE,
  deposit?: { txHash: string; status: string },
) => ({
  kind: deposit ? "deposit" : "invoice",
  at: inv.createdAt,
  invoiceId: inv.invoiceId,
  chainId: inv.chainId,
  token: inv.token,
  symbol: "USDC",
  decimals: 6,
  amount: inv.amount,
  status: deposit ? deposit.status : inv.paymentStatus,
  ...(deposit ? { txHash: deposit.txHash } : { settlementStatus: inv.settlementStatus }),
});
const ACTIVITY = INVOICES.flatMap((inv) => [
  ...((DEPOSITS[inv.invoiceId] ?? []) as { txHash: string; status: string }[]).map((d) =>
    activityItem(inv, d),
  ),
  activityItem(inv),
]);
const sampleTransfer = (i: number) => ({
  chainId: 84532,
  token: USDC,
  symbol: "USDC",
  decimals: 6,
  direction: i % 4 === 3 ? "out" : "in",
  amount: `${(i + 1) * 1_000_000}`,
  counterparty: `0x${String(i).padStart(2, "0")}${"b".repeat(38)}`,
  txHash: `0x${String(i).padStart(2, "0")}${"9".repeat(62)}`,
  logIndex: 0,
  blockNumber: 1000 - i,
  at: new Date(NOW - i * 7_200_000).toISOString(),
  status: "confirmed",
});
const TRANSFERS = Array.from({ length: 30 }, (_, i) => sampleTransfer(i));

type SampleInvoice = typeof CONFIRMING_INVOICE;
interface SampleItem {
  kind: string;
  status: string;
  settlementStatus?: string;
  txHash?: string;
  symbol: string;
}
type SampleTransfer = ReturnType<typeof sampleTransfer>;
interface SampleLists {
  invoices: SampleInvoice[];
  activity: SampleItem[];
  transfers: SampleTransfer[];
}
const SAMPLE_LISTS: SampleLists = { invoices: INVOICES, activity: ACTIVITY, transfers: TRANSFERS };

// The API's filters and search (docs/backend/api.md) on the fields these samples use, then its cursor pages.
const invoiceFilter = (inv: Pick<SampleInvoice, "paymentStatus" | "settlementStatus">) =>
  inv.settlementStatus === "settled"
    ? "settled"
    : inv.paymentStatus === "paid"
      ? "paid"
      : inv.paymentStatus.startsWith("expired")
        ? "expired"
        : "open";
const itemFilter = (item: SampleItem) =>
  item.kind === "invoice"
    ? invoiceFilter({ paymentStatus: item.status, settlementStatus: item.settlementStatus ?? "" })
    : item.status === "confirmed"
      ? "paid"
      : "open";
function listPage<T>(
  url: URL,
  items: T[],
  filterOf: (t: T) => string,
  textOf: (t: T) => (string | null | undefined)[],
) {
  const limit = Number(url.searchParams.get("limit") ?? 20);
  const start = Number(url.searchParams.get("cursor") ?? 0);
  const filter = url.searchParams.get("status") ?? url.searchParams.get("direction");
  const q = url.searchParams.get("q")?.toLowerCase();
  const matched = items.filter(
    (t) =>
      (!filter || filterOf(t) === filter) &&
      (!q || textOf(t).some((text) => text?.toLowerCase().includes(q))),
  );
  const end = start + limit;
  return {
    items: matched.slice(start, end),
    nextCursor: end < matched.length ? String(end) : null,
  };
}

async function mockApi(page: Page, lists: SampleLists = SAMPLE_LISTS) {
  // Our API only: Privy's own API is also under /api/v1.
  await page.route("/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    if (path === "/v1/me") {
      return route.fulfill({
        json: {
          profiles: [
            {
              profileId: MERCHANT_ID,
              kind: "merchant",
              name: "Sample shop",
              walletAddress: `0x${"7a21".repeat(10)}`,
              createdAt: "2026-09-02T00:00:00Z",
            },
          ],
        },
      });
    }
    // The public read leaves out the client; the profile's own read has it.
    const owned = lists.invoices.find(
      (inv) => path === `/v1/profiles/${MERCHANT_ID}/invoices/${inv.invoiceId}`,
    );
    if (owned) {
      return route.fulfill({ json: { ...owned, deposits: DEPOSITS[owned.invoiceId] ?? [] } });
    }
    const invoice = lists.invoices.find((inv) => path === `/v1/invoices/${inv.invoiceId}`);
    if (invoice) {
      const { client: _, ...open } = invoice;
      return route.fulfill({ json: { ...open, deposits: DEPOSITS[invoice.invoiceId] ?? [] } });
    }
    const what = path.split(`/v1/profiles/${MERCHANT_ID}/`)[1];
    if (what === "invoices") {
      const json = listPage(url, lists.invoices, invoiceFilter, (inv: SampleInvoice) => [
        `INV-${String(inv.number).padStart(4, "0")}`,
        inv.title,
        inv.note,
        inv.client.name,
        inv.client.email,
        inv.receiveAddress,
      ]);
      return route.fulfill({ json });
    }
    if (what === "activity") {
      const json = listPage(url, lists.activity, itemFilter, (item) => [item.txHash, item.symbol]);
      return route.fulfill({ json });
    }
    if (what === "transactions") {
      const json = listPage(
        url,
        lists.transfers,
        (t: SampleTransfer) => t.direction,
        (t) => [t.counterparty, t.txHash, t.symbol],
      );
      return route.fulfill({ json });
    }
    if (what === "balances") {
      return route.fulfill({
        json: {
          tokens: [
            {
              chainId: 84532,
              token: USDC,
              symbol: "USDC",
              decimals: 6,
              wallet: "18420350000",
              finalizedBlock: 1000,
              pending: "0",
              held: "0",
            },
          ],
          estimatedUsdTotal: "18420.35",
        },
      });
    }
    if (what === "balance-history") {
      // A point per day: a year of them is what once ran the chart's hidden table far below the page.
      const days = Number(url.searchParams.get("days"));
      const zeros = Array.from({ length: days }, () => "0");
      return route.fulfill({
        json: {
          points: zeros.map((_, i) => ({
            at: new Date(NOW - (days - 1 - i) * 86_400_000).toISOString(),
            estimatedUsd: "18420.35",
            receivedUsd: "0.00",
            sentUsd: "0.00",
          })),
          tokens: [
            {
              chainId: 84532,
              token: USDC,
              symbol: "USDC",
              decimals: 6,
              balances: zeros.map(() => "18420350000"),
              received: zeros,
              sent: zeros,
            },
          ],
        },
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
}

test("app pages navigate from the breadcrumb and rows, filter and search, link to the explorer, and keep the sidebar fixed", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  const sidebar = page.locator("aside");
  const crumbs = page.getByRole("banner").getByRole("navigation", { name: "Breadcrumb" });
  const main = page.getByRole("main");
  const basescan = (txHash: string) => `https://sepolia.basescan.org/tx/${txHash}`;
  // The page's name is the breadcrumb's: the heading stays for screen readers only.
  const hiddenHeading = async (name: string) => {
    const heading = page.getByRole("heading", { level: 1, name });
    await expect(heading).toBeAttached();
    expect((await heading.boundingBox())?.width).toBeLessThanOrEqual(1);
  };

  // Invoices: status filter and search in the toolbar.
  await page.goto("/app/invoices");
  await expect(crumbs.getByRole("link", { name: "Invoices" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await hiddenHeading("Invoices");
  const rows = main.getByRole("row").filter({ hasText: "INV-" });
  await expect(rows).toHaveCount(4);
  const status = main.getByRole("group", { name: "Status" });
  await status.getByText("Settled", { exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("INV-0003");
  await status.getByText("Open", { exact: true }).click();
  await expect(rows).toHaveCount(2);
  const search = main.getByRole("searchbox", { name: "Search invoices" });
  await search.fill("brightline");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("INV-0004");
  await status.getByText("All", { exact: true }).click();
  await search.fill("inv-0001");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Expired");
  await search.fill("");
  expect(await blockingViolations(page)).toEqual([]);

  // A row opens its invoice; the breadcrumb ends at its number and leads back, with no separate back link.
  await rows.filter({ hasText: "INV-0004" }).click();
  await expect(page).toHaveURL(`/app/invoices/${CONFIRMING_INVOICE.invoiceId}`);
  await expect(crumbs.getByRole("link", { name: "INV-0004" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await hiddenHeading("INV-0004");
  await expect(main.getByRole("link", { name: "Invoices" })).toHaveCount(0);
  await expect(main.getByRole("region", { name: "Client" })).toContainText("Brightline Studio");
  // A payment on its way: pending, a short line, and its transaction on Basescan.
  await expect(main.getByRole("status").filter({ hasText: /./ })).toHaveText(
    "Confirming · about 6 min left 120 blocks",
  );
  // The timeline carries the invoice's status, at its Confirming step; the one pill left is the payment's own.
  const amountPanel = main.getByRole("region", { name: "Amount" });
  await expect(amountPanel.locator("[data-status]")).toHaveCount(1);
  await expect(
    amountPanel
      .getByRole("list", { name: "Payment progress" })
      .getByRole("listitem")
      .filter({ hasText: "Confirming" }),
  ).toHaveAttribute("aria-current", "step");
  const payment = main.getByRole("link", { name: "View transaction on Basescan" });
  await expect(payment).toHaveAttribute("href", basescan(hash("d")));
  await expect(payment).toHaveAttribute("target", "_blank");
  const paymentRow = main
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: "View transaction on Basescan" }) });
  await expect(paymentRow.getByRole("button", { name: `0x${"c".repeat(40)}` })).toHaveText(
    "0xcccc…cccc",
  );
  await expect(paymentRow.locator("time")).toHaveAttribute("datetime", "2026-10-09T08:30:00Z");
  expect(await blockingViolations(page)).toEqual([]);
  await crumbs.getByRole("link", { name: "Invoices" }).click();
  await expect(page).toHaveURL("/app/invoices");
  await crumbs.getByRole("link", { name: "Merchant · Sample shop" }).click();
  await expect(page).toHaveURL("/app");

  // Activity: every row opens its invoice, a payment also links to its transaction; filter and search.
  await sidebar.getByRole("link", { name: "Activity" }).click();
  await hiddenHeading("Activity");
  const items = main.getByRole("listitem");
  await expect(items).toHaveCount(6);
  await expect(
    items.first().getByRole("link", { name: "View transaction on Basescan" }),
  ).toHaveAttribute("href", basescan(hash("d")));
  const activityStatus = main.getByRole("group", { name: "Status" });
  await activityStatus.getByText("Paid", { exact: true }).click();
  await expect(items).toHaveCount(1);
  await expect(items).toContainText("Confirmed");
  await activityStatus.getByText("All", { exact: true }).click();
  await main.getByRole("searchbox", { name: "Search activity" }).fill(hash("e").slice(0, 10));
  await expect(items).toHaveCount(1);
  expect(await blockingViolations(page)).toEqual([]);
  await items.getByRole("link", { name: "Payment" }).click();
  await expect(page).toHaveURL(`/app/invoices/${SETTLED_INVOICE.invoiceId}`);
  await page.goBack();
  await main.getByRole("searchbox", { name: "Search activity" }).fill("");
  await items
    .filter({ hasText: "Waiting for payment" })
    .getByRole("link", { name: "Invoice" })
    .click();
  await expect(page).toHaveURL(`/app/invoices/${OPEN_INVOICE.invoiceId}`);

  // Transactions: each transfer links to its transaction.
  await sidebar.getByRole("link", { name: "Transactions" }).click();
  await hiddenHeading("Transactions");
  await expect(
    main.getByRole("table").getByRole("link", { name: "View transaction on Basescan" }).first(),
  ).toHaveAttribute("href", basescan(`0x00${"9".repeat(62)}`));
  expect(await blockingViolations(page)).toEqual([]);

  // The sidebar stays in view down to the bottom of a long page, open and collapsed, and nothing runs on below the
  // content (a year of chart data once did).
  await sidebar.getByRole("link", { name: "Overview", exact: true }).click();
  await main.getByRole("group", { name: "Chart range" }).getByText("1Y", { exact: true }).click();
  await expect(main.getByRole("img", { name: /^Received/ })).toBeVisible();
  for (const collapse of [false, true]) {
    if (collapse) await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const box = await sidebar.boundingBox();
    expect(box).toMatchObject({ x: 0, y: 0, height: 900, width: collapse ? 64 : 256 });
    const below = await page.evaluate(
      () =>
        document.documentElement.scrollHeight -
        (document.querySelector("main")?.getBoundingClientRect().bottom ?? 0) -
        window.scrollY,
    );
    expect(below).toBeLessThanOrEqual(1);
  }
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await context.close();

  // A phone: the filters and rows fit without sideways scrolling, and the invoice has its back link.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    storageState: session,
  });
  const small = await phone.newPage();
  await mockApi(small);
  for (const path of ["/app/invoices", "/app/activity", "/app/transactions"]) {
    await small.goto(path);
    await expect(small.getByRole("main").getByRole("searchbox")).toBeVisible();
    expect(await small.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  }
  await small.goto(`/app/invoices/${CONFIRMING_INVOICE.invoiceId}`);
  await expect(small.getByRole("heading", { level: 1, name: "INV-0004" })).toBeVisible();
  await expect(small.getByRole("main").getByRole("link", { name: "Invoices" })).toBeVisible();
  expect(await small.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(await blockingViolations(small)).toEqual([]);
  await phone.close();
});

// Lists longer than a page (20 rows); each search's one match sits on the third page.
const LONG_INVOICES = Array.from({ length: 45 }, (_, i) =>
  sampleInvoice(45 - i, "open", "none", i === 42 ? "Zephyr retainer" : "Monthly work", null),
);
const PAST_PAGE_DEPOSIT = hash("7");
const LONG_ACTIVITY = LONG_INVOICES.map((inv) => activityItem(inv));
LONG_ACTIVITY.splice(
  40,
  0,
  activityItem(sampleInvoice(5, "open", "none", "Monthly work", null), {
    txHash: PAST_PAGE_DEPOSIT,
    status: "confirmed",
  }),
);
const PAST_PAGE_PARTY = `0x${"f".repeat(40)}`;
const LONG_TRANSFERS = Array.from({ length: 45 }, (_, i) => ({
  ...sampleTransfer(i),
  direction: "in",
  ...(i === 40 ? { counterparty: PAST_PAGE_PARTY } : {}),
}));

test("Invoices, Activity and Transactions filter and search on the API: a match past the first page shows, and the URL keeps them", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page, {
    invoices: LONG_INVOICES,
    activity: LONG_ACTIVITY,
    transfers: LONG_TRANSFERS,
  });
  const searched: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const q = url.searchParams.get("q");
    if (q && url.pathname.startsWith("/api/v1/profiles/")) searched.push(q);
  });
  const main = page.getByRole("main");

  // Invoices: INV-0003 is the 43rd invoice. Typing sends one request, after the last key.
  await page.goto("/app/invoices");
  const rows = main.getByRole("row").filter({ hasText: "INV-" });
  await expect(rows).toHaveCount(20);
  const invoiceSearch = main.getByRole("searchbox", { name: "Search invoices" });
  await invoiceSearch.pressSequentially("zephyr", { delay: 50 });
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("INV-0003");
  await expect(page).toHaveURL("/app/invoices?q=zephyr");
  expect(searched).toEqual(["zephyr"]);
  await page.reload();
  await expect(invoiceSearch).toHaveValue("zephyr");
  await expect(rows).toHaveCount(1);
  // A filter joins the search in the URL; nothing matched says so and offers to clear both.
  await main.getByRole("group", { name: "Status" }).getByText("Paid", { exact: true }).click();
  await expect(page).toHaveURL("/app/invoices?q=zephyr&status=paid");
  await expect(main.getByText("No invoices match.")).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  await main.getByRole("button", { name: "Clear filter and search" }).click();
  await expect(page).toHaveURL("/app/invoices");
  await expect(invoiceSearch).toHaveValue("");
  await expect(rows).toHaveCount(20);
  // "Show more" continues the searched list, and Back from an invoice returns to it.
  await invoiceSearch.fill("monthly");
  await expect(page).toHaveURL("/app/invoices?q=monthly");
  await main.getByRole("button", { name: "Show more" }).click();
  await expect(rows).toHaveCount(40);
  await rows.first().getByRole("link").click();
  await expect(page).toHaveURL(`/app/invoices/${LONG_INVOICES[0]?.invoiceId}`);
  await page.goBack();
  await expect(page).toHaveURL("/app/invoices?q=monthly");
  await expect(invoiceSearch).toHaveValue("monthly");

  // Activity: the payment is the 41st item.
  await page.goto("/app/activity");
  const items = main.getByRole("listitem");
  await expect(items).toHaveCount(20);
  await main
    .getByRole("searchbox", { name: "Search activity" })
    .fill(PAST_PAGE_DEPOSIT.slice(0, 12));
  await expect(items).toHaveCount(1);
  await expect(items).toContainText("Payment");
  await main.getByRole("group", { name: "Status" }).getByText("Paid", { exact: true }).click();
  await expect(page).toHaveURL(`/app/activity?q=${PAST_PAGE_DEPOSIT.slice(0, 12)}&status=paid`);
  await page.reload();
  await expect(items).toHaveCount(1);
  await expect(main.getByRole("searchbox", { name: "Search activity" })).toHaveValue(
    PAST_PAGE_DEPOSIT.slice(0, 12),
  );

  // Transactions, opened with a search as ⌘K and notifications link it: the 41st transfer.
  await page.goto(`/app/transactions?q=${PAST_PAGE_PARTY}`);
  const transfers = main.getByRole("table").locator("tbody tr");
  await expect(transfers).toHaveCount(1);
  await expect(main.getByRole("searchbox", { name: "Search transactions" })).toHaveValue(
    PAST_PAGE_PARTY,
  );
  await main.getByRole("group", { name: "Direction" }).getByText("Out", { exact: true }).click();
  await expect(page).toHaveURL(`/app/transactions?q=${PAST_PAGE_PARTY}&direction=out`);
  await expect(main.getByText("No transactions match.")).toBeVisible();
  await page.reload();
  await expect(main.getByText("No transactions match.")).toBeVisible();
  await main.getByRole("button", { name: "Clear filter and search" }).click();
  await expect(transfers).toHaveCount(20);
  await context.close();
});

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
  await expect(sidebar.getByRole("button", { name: /^Switch profile: Freelancer/ })).toBeVisible();
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
  await page.getByRole("combobox", { name: "Country" }).click();
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(await blockingViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Skip for now" }).click();

  await expect(checklist(page)).toBeVisible();
  expect(user.choices).toEqual([[]]);
  expect(user.profiles).toHaveLength(1);
  await expect(checklist(page).getByRole("listitem")).toHaveCount(4);
  await expect(step(page, "Add billing details")).toHaveCount(0);
  // A personal profile's first invoice is a request, made in the request sheet.
  await step(page, "Request money").getByRole("button", { name: "Request", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Request money" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(await blockingViolations(page)).toEqual([]);
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
