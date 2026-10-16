import { expect, type Page, test } from "@playwright/test";
import { sidewaysScroll } from "../sideways";
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

// Creates an invoice and returns its number and the API's answer, or null when this database has no enabled network: the
// page then says so instead of showing the form.
async function createInvoice(page: Page, fill: () => Promise<void>) {
  await expect(page.getByRole("heading", { level: 1, name: "New invoice" })).toBeVisible();
  const noNetworks = page.getByText("No networks are enabled yet");
  await expect(noNetworks.or(page.getByRole("button", { name: "Create invoice" }))).toBeVisible();
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
  const body = (await response.json()) as {
    invoiceId: string;
    number: number;
    returnUrl: string | null;
    options: object[];
  };
  await expect(page).toHaveURL(`/app/invoices/${body.invoiceId}`);
  return { ...body, number: `INV-${String(body.number).padStart(4, "0")}` };
}

// One token and network, when the database has more than one to choose from (R-56); other networks may be on locally.
async function fixUsdcOnBase(page: Page) {
  const fixed = page.getByRole("radio", { name: "One token" });
  if (await fixed.count()) await page.getByText("One token", { exact: true }).click();
  await page.getByRole("combobox", { name: "Network and token" }).click();
  await page.getByRole("option", { name: "USDC · Base Sepolia" }).click();
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

  // R-86: a saved client fills the invoice below, which keeps its copy after the client is deleted at the end.
  const clientName = `E2E client ${Date.now()}`;
  await sidebar.getByRole("link", { name: "Clients" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Clients" })).toBeAttached();
  expect(await blockingViolations(page)).toEqual([]);
  await page.getByRole("link", { name: "Add client" }).first().click();
  await expect(page).toHaveURL("/app/clients/new");
  await page.getByRole("textbox", { name: "Name or business name" }).fill(clientName);
  await page.getByRole("textbox", { name: "Billing email (optional)" }).fill("client@example.com");
  await page.getByRole("textbox", { name: "Address (optional)" }).fill("1 Test Street\nBerlin");
  // A long list is searched: typing narrows the countries.
  await page.getByRole("button", { name: /^Country \(optional\)/ }).click();
  await page.getByRole("combobox", { name: /Country \(optional\)/ }).fill("germ");
  await expect(page.getByRole("option")).toHaveCount(1);
  expect(await blockingViolations(page)).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Country \(optional\)/ })).toContainText(
    "Germany",
  );
  await page.getByRole("textbox", { name: "Tax or VAT ID (optional)" }).fill("DE123456789");
  expect(await blockingViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Save client" }).click();
  await expect(page).toHaveURL("/app/clients");
  const clientRow = page.getByRole("row").filter({ hasText: clientName });
  await expect(clientRow).toContainText("client@example.com");
  await expect(clientRow).toContainText("Germany");
  await expect(clientRow).toContainText("DE123456789");
  expect(await blockingViolations(page)).toEqual([]);
  await sidebar.getByRole("link", { name: "Invoices" }).click();
  await page.getByRole("link", { name: "New invoice" }).first().click();

  const title = `E2E ${Date.now()}`;
  let due = "";
  const invoice = await createInvoice(page, async () => {
    await fixUsdcOnBase(page);
    // An amount the token can't hold and a link that is not https are named on their fields before anything is sent;
    // focus goes to the first.
    const amount = page.getByRole("textbox", { name: "Amount" });
    const link = page.getByRole("textbox", { name: "Return link (optional)" });
    await amount.fill("1.1234567");
    await link.fill("http://shop.example/thanks");
    await page.getByRole("button", { name: "Create invoice" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /has 6 decimals/ })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Enter an https link" })).toBeVisible();
    await expect(amount).toHaveAttribute("aria-invalid", "true");
    await expect(link).toHaveAttribute("aria-invalid", "true");
    await expect(amount).toBeFocused();
    expect(await blockingViolations(page)).toEqual([]);
    await amount.fill("12.5");
    await link.fill("https://shop.example/thanks");
    await page.getByRole("textbox", { name: "Title (optional)" }).fill(title);
    await page.getByRole("textbox", { name: "Note to the client (optional)" }).fill("Thank you");
    // The due date comes from the kit calendar (R-59): a month from today.
    await page.getByRole("button", { name: /^Due date \(optional\)/ }).click();
    await page.keyboard.press("PageDown");
    await page.keyboard.press("Enter");
    due = await page.locator('input[name="dueDate"]').inputValue();
    expect(due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await page.getByText("1 day", { exact: true }).click();
    await expect(page.getByRole("radio", { name: "1 day" })).toBeChecked();
    await page.getByRole("button", { name: /^Saved client/ }).click();
    await page.getByRole("combobox", { name: /Saved client/ }).fill(clientName);
    await page.getByRole("option", { name: new RegExp(`^${clientName}`) }).click();
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(clientName);
    await expect(page.getByRole("textbox", { name: "Tax or VAT ID" })).toHaveValue("DE123456789");
  });
  if (invoice) {
    expect(invoice.returnUrl).toBe("https://shop.example/thanks");
    expect(invoice.options).toHaveLength(1);
    const dueText = new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${due}T00:00:00Z`));
    // The detail: number, amount in the token, the timeline, due date apart from the checkout's close, the client.
    // Nothing paid yet: the first step is the current one.
    await expect(page.getByRole("heading", { level: 1, name: invoice.number })).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();
    const amount = page.getByRole("region", { name: "Amount" });
    await expect(amount).toContainText("12.50 USDC");
    await expect(amount.getByRole("list", { name: "Payment progress" })).toContainText(
      /Waiting.*Detected.*Confirming.*Paid.*Settled/,
    );
    await expect(amount.getByRole("listitem").filter({ hasText: "Waiting" })).toHaveAttribute(
      "aria-current",
      "step",
    );
    // No status pill: the timeline carries the status, and no payment has come in yet.
    await expect(amount.locator("[data-status]")).toHaveCount(0);
    const details = page.getByRole("region", { name: "Details" });
    await expect(details).toContainText("Due date");
    await expect(details).toContainText(dueText);
    await expect(details).toContainText("Checkout closes");
    // R-60: each said once, the status by the timeline and the close time in Details, so the header has neither.
    await expect(page.getByRole("main").locator("header [data-status]")).toHaveCount(0);
    await expect(page.getByRole("main").locator("header")).not.toContainText("Checkout closes");
    const client = page.getByRole("region", { name: "Billed to" });
    await expect(client).toContainText(clientName);
    await expect(client).toContainText("client@example.com");
    await expect(client).toContainText("Germany");
    await expect(client).toContainText("Tax ID DE123456789");
    // The pay link copies whole, from the header's More actions menu, which also opens it.
    const link = `http://localhost:3000/pay/${invoice.invoiceId}`;
    await page
      .getByRole("main")
      .locator("header")
      .getByRole("button", { name: "More actions" })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Open pay page in a new tab" }),
    ).toHaveAttribute("href", link);
    await page.getByRole("menuitem", { name: "Copy link" }).click();
    await expect(page.getByRole("menuitem", { name: "Link copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await page.keyboard.press("Escape");
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

    // A payment to an option the client did not end up paying with is listed apart, as held for the payer (F143).
    const heldTx = `0x${"4".repeat(64)}`;
    await page.route(`**/api/v1/**/invoices/${invoice.invoiceId}`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const held = {
        optionId: `0x${"5".repeat(64)}`,
        chainId: 421614,
        network: "arbitrum-sepolia",
        token: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
        symbol: "USDC",
        decimals: 6,
        amount: body.amount,
        receiveAddress: `0x${"6".repeat(40)}`,
        deposits: [
          {
            txHash: heldTx,
            logIndex: 0,
            from: `0x${"7".repeat(40)}`,
            amount: "2000000",
            blockNumber: 1,
            blockTime: body.createdAt,
            status: "confirmed",
            late: false,
            blocksLeft: 0,
            blocksTotal: 0,
            secondsLeft: 0,
          },
        ],
      };
      await route.fulfill({
        response,
        json: { ...body, optionLocked: true, options: [...body.options, held] },
      });
    });
    await page.reload();
    const held = page.getByText("Held for the payer · USDC on Arbitrum Sepolia");
    await expect(held).toBeVisible();
    const heldList = held.locator("xpath=following-sibling::ul");
    await expect(heldList).toContainText("2.00 USDC");
    await expect(
      heldList.getByRole("link", { name: "View transaction on Arbiscan" }),
    ).toHaveAttribute("href", `https://sepolia.arbiscan.io/tx/${heldTx}`);
    expect(await blockingViolations(page)).toEqual([]);
    await page.unroute(`**/api/v1/**/invoices/${invoice.invoiceId}`);

    // Back in the list, newest first.
    await page.getByRole("link", { name: "Invoices" }).first().click();
    const row = page.getByRole("row").filter({ hasText: invoice.number });
    await expect(row).toContainText(title);
    await expect(row).toContainText(clientName);
    await expect(row).toContainText(dueText);
    await expect(row).toContainText("12.50 USDC");
    await expect(row).toContainText("Waiting for payment");
    await row.getByRole("link", { name: invoice.number }).click();
    await expect(page.getByRole("heading", { level: 1, name: invoice.number })).toBeVisible();
  }

  // A row opens the client's page, whose More actions menu deletes it after asking.
  await sidebar.getByRole("link", { name: "Clients" }).click();
  await clientRow.getByRole("link", { name: clientName }).click();
  await expect(page).toHaveURL(/\/app\/clients\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("textbox", { name: "Tax or VAT ID (optional)" })).toHaveValue(
    "DE123456789",
  );
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete client" }).click();
  await page
    .getByRole("dialog", { name: `Delete ${clientName}?` })
    .getByRole("button", { name: "Delete client" })
    .click();
  await expect(page).toHaveURL("/app/clients");
  await expect(clientRow).toHaveCount(0);
  if (invoice) {
    await sidebar.getByRole("link", { name: "Invoices" }).click();
    await page
      .getByRole("row")
      .filter({ hasText: invoice.number })
      .getByRole("link", { name: invoice.number })
      .click();
    await expect(page.getByRole("region", { name: "Billed to" })).toContainText(
      "Tax ID DE123456789",
    );
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
  const fits = async () => expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  await page.goto("/app");
  const tabs = page.getByRole("navigation", { name: "Main" });
  const more = page.getByRole("dialog", { name: "More" });
  await chooseMerchant(page, async () => {
    await tabs.getByRole("button", { name: "More" }).click();
    await more.getByRole("button", { name: /^Switch profile:/ }).click();
  });
  await tabs.getByRole("button", { name: "More" }).click();
  await expect(more.getByRole("link", { name: "Activity", exact: true })).toBeVisible();
  await expect(more.getByRole("link", { name: "Billing details", exact: true })).toBeVisible();
  // R-86: the Clients page and its form fit a phone.
  await more.getByRole("link", { name: "Clients", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Clients" })).toBeVisible();
  await fits();
  await page.getByRole("link", { name: "Add client" }).first().click();
  await page.getByRole("button", { name: /^Country \(optional\)/ }).click();
  await expect(page.getByRole("combobox", { name: /Country \(optional\)/ })).toBeFocused();
  await fits();
  await page.keyboard.press("Escape");
  await tabs.getByRole("button", { name: "More" }).click();
  await more.getByRole("link", { name: "Invoices", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Invoices" })).toBeVisible();
  await fits();
  await page.getByRole("link", { name: "New invoice" }).first().click();
  // Payer chooses is the default (R-56): the amount is in USD.
  let choosing = false;
  const invoice = await createInvoice(page, async () => {
    await fits();
    choosing = (await page.getByRole("radio", { name: "Client chooses" }).count()) > 0;
    if (choosing) await expect(page.getByRole("radio", { name: "Client chooses" })).toBeChecked();
    await page.getByRole("textbox", { name: choosing ? "Amount in USD" : "Amount" }).fill("1");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("E2E phone client");
    expect(await blockingViolations(page)).toEqual([]);
  });
  if (invoice) {
    await expect(page.getByRole("heading", { level: 1, name: invoice.number })).toBeVisible();
    const amount = page.getByRole("region", { name: "Amount" });
    await expect(amount).toContainText(choosing ? "1.00 USD" : "1.00 USDC");
    if (choosing) {
      expect(invoice.options.length).toBeGreaterThan(1);
      await expect(amount).toContainText(`The client picks one of ${invoice.options.length}`);
    }
    await fits();
    expect(await blockingViolations(page)).toEqual([]);
    await page.getByRole("link", { name: "Invoices" }).click();
    // Phone rows lead with the client, then the number.
    await expect(
      page.getByRole("link", { name: new RegExp(`\\b${invoice.number}\\b`) }),
    ).toBeVisible();
    await fits();
    expect(await blockingViolations(page)).toEqual([]);
  }
  await context.close();
});
