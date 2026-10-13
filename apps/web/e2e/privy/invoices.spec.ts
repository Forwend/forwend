import { expect, type Page, test } from "@playwright/test";
import { blockingViolations } from "./axe";
import { session } from "./session";

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
  // Other networks may be on locally.
  await page.getByRole("combobox", { name: "Network and token" }).click();
  await page.getByRole("option", { name: "USDC · Base Sepolia" }).click();
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
    // R-60: one status at once, with when the checkout closes, above the two columns.
    await expect(page.getByRole("main").locator("header [data-status]")).toHaveText(
      "Waiting for payment",
    );
    await expect(page.getByRole("main").locator("header")).toContainText("Checkout closes");
    const client = page.getByRole("region", { name: "Billed to" });
    await expect(client).toContainText("E2E client");
    await expect(client).toContainText("client@example.com");
    // The pay link copies whole.
    const link = `http://localhost:3000/pay/${invoice.invoiceId}`;
    const share = page.getByRole("region", { name: "Pay link" });
    // The row shows the host and a short id; the whole link is its title, Copy and Open.
    await expect(share.locator("p[title]")).toHaveAttribute("title", link);
    await expect(
      share.getByRole("link", { name: "Open the pay page in a new tab" }),
    ).toHaveAttribute("href", link);
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
