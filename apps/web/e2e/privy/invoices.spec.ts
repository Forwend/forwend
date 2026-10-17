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
  const form = noNetworks.or(page.getByRole("button", { name: "Create invoice" }));
  // R-92: the shared merchant profile saves its billing details once, before its first invoice.
  const billing = page.getByRole("main").getByRole("link", { name: "Add billing details" });
  await expect(form.or(billing)).toBeVisible();
  if (await billing.isVisible()) {
    await billing.click();
    await page.getByRole("textbox", { name: "Name or business name" }).fill("E2E shop GmbH");
    await page.getByRole("textbox", { name: "Address" }).fill("1 Test Street, Berlin");
    await page.getByRole("button", { name: /^Country/ }).click();
    await page.getByRole("combobox", { name: /Country/ }).fill("germ");
    await page.keyboard.press("Enter");
    await page.getByRole("textbox", { name: "Contact email" }).fill("billing@e2e.example");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page).toHaveURL("/app/invoices/new");
  }
  await expect(form).toBeVisible();
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
  const po = `PO-${Date.now()}`;
  await sidebar.getByRole("link", { name: "Clients" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Clients" })).toBeAttached();
  expect(await blockingViolations(page)).toEqual([]);
  await page.getByRole("link", { name: "Add client" }).first().click();
  await expect(page).toHaveURL("/app/clients/new");
  await page.getByRole("textbox", { name: "Name or business name" }).fill(clientName);
  // Resend's test inbox: Send to client below queues an email, which a running worker would really send.
  await page
    .getByRole("textbox", { name: "Billing email (optional)" })
    .fill("delivered@resend.dev");
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
  await page.getByRole("textbox", { name: "Default PO or reference (optional)" }).fill(po);
  expect(await blockingViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Save client" }).click();
  await expect(page).toHaveURL("/app/clients");
  const clientRow = page.getByRole("row").filter({ hasText: clientName });
  await expect(clientRow).toContainText("delivered@resend.dev");
  await expect(clientRow).toContainText("Germany");
  await expect(clientRow).toContainText("DE123456789");
  expect(await blockingViolations(page)).toEqual([]);
  await sidebar.getByRole("link", { name: "Invoices" }).click();
  await page.getByRole("link", { name: "New invoice" }).first().click();

  const title = `E2E ${Date.now()}`;
  let due = "";
  let supplied = "";
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
    // R-89: the supply date, a month back, the work having been done before the invoice.
    await page.getByRole("button", { name: /^Supply date \(optional\)/ }).click();
    await page.keyboard.press("PageUp");
    await page.keyboard.press("Enter");
    supplied = await page.locator('input[name="supplyDate"]').inputValue();
    expect(supplied).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The due date comes from the kit calendar (R-59): a month from today.
    await page.getByRole("button", { name: /^Due date \(optional\)/ }).click();
    await page.keyboard.press("PageDown");
    await page.keyboard.press("Enter");
    due = await page.locator('input[name="dueDate"]').inputValue();
    expect(due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // D-80 (R-87): the checkout then stays open 60 days past the due date; a shorter close is allowed but warned.
    await expect(page.getByRole("radio", { name: "Custom" })).toBeChecked();
    const openUntil = new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(Date.parse(`${due}T00:00:00Z`) + 60 * 86_400_000));
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: `Open until ${openUntil}, so a client who pays late` }),
    ).toBeVisible();
    await page.getByText("1 day", { exact: true }).click();
    await expect(page.getByRole("radio", { name: "1 day" })).toBeChecked();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: `This closes before ${openUntil}, 60 days after the due date.` }),
    ).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);
    await page.getByRole("button", { name: /^Saved client/ }).click();
    await page.getByRole("combobox", { name: /Saved client/ }).fill(clientName);
    await page.getByRole("option", { name: new RegExp(`^${clientName}`) }).click();
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(clientName);
    await expect(page.getByRole("textbox", { name: "Tax or VAT ID" })).toHaveValue("DE123456789");
    // R-90: the saved client's default PO number fills the invoice's reference.
    await expect(page.getByRole("textbox", { name: "PO or reference (optional)" })).toHaveValue(po);
    // R-93: the price agreed with the client in euros, today.
    await page.getByRole("button", { name: "Add agreed value" }).click();
    await page.getByRole("button", { name: /^Agreed in/ }).click();
    await page.getByRole("combobox", { name: /Agreed in/ }).fill("euro");
    await page.keyboard.press("Enter");
    await page.getByRole("textbox", { name: "Agreed amount" }).fill("1150.5");
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
    await expect(details.locator("div").filter({ hasText: /^Supply date/ })).toContainText(
      new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(`${supplied}T00:00:00Z`),
      ),
    );
    await expect(details.locator("div").filter({ hasText: /^Reference/ })).toContainText(po);
    await expect(details.locator("div").filter({ hasText: /^Agreed value/ })).toContainText(
      "€1,150.50",
    );
    await expect(details).toContainText("Checkout closes");
    // R-60: each said once, the status by the timeline and the close time in Details, so the header has neither.
    await expect(page.getByRole("main").locator("header [data-status]")).toHaveCount(0);
    await expect(page.getByRole("main").locator("header")).not.toContainText("Checkout closes");
    const client = page.getByRole("region", { name: "Billed to" });
    await expect(client).toContainText(clientName);
    await expect(client).toContainText("delivered@resend.dev");
    await expect(client).toContainText("Germany");
    await expect(client).toContainText("Tax ID DE123456789");
    // R-94: Send to client queues the email to the client's address; the panel then lists it, and the next send waits a
    // day. The test starts the api alone, so the email waits unless a dev worker runs.
    const sent = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/invoices/${invoice.invoiceId}/send`) && r.request().method() === "POST",
    );
    await client.getByRole("button", { name: "Send to client" }).click();
    expect((await sent).status()).toBe(201);
    await expect(
      page.getByText(`${invoice.number} is on its way to delivered@resend.dev`),
    ).toBeVisible();
    await expect(client).toContainText(
      /Sending to delivered@resend\.dev|Emailed to delivered@resend\.dev/,
    );
    await expect(client.getByRole("button", { name: "Send to client" })).toHaveCount(0);
    // The button goes, so focus moves to the line that takes its place.
    await expect(client.getByText(/^You can send it again after/)).toBeFocused();
    expect(await blockingViolations(page)).toEqual([]);
    // R-96: payment reminders, saved when flipped; the due date is a month away, so none goes yet. Off again after.
    const reminders = client.getByRole("switch", { name: "Payment reminders" });
    await expect(reminders).not.toBeChecked();
    await expect(client).toContainText("Emails the client 3 days before the due date");
    await reminders.click();
    await expect(page.getByText("Payment reminders on")).toBeVisible();
    await expect(reminders).toBeChecked();
    expect(await blockingViolations(page)).toEqual([]);
    await reminders.click();
    await expect(page.getByText("Payment reminders off")).toBeVisible();
    await expect(reminders).not.toBeChecked();
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
    // R-91: Duplicate opens New invoice filled from this one, with dates of its own.
    await page
      .getByRole("main")
      .locator("header")
      .getByRole("button", { name: "More actions" })
      .click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "New invoice" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Title (optional)" })).toHaveValue(title);
    await expect(page.getByRole("textbox", { name: "PO or reference (optional)" })).toHaveValue(po);
    await expect(page.getByRole("textbox", { name: "Note to the client (optional)" })).toHaveValue(
      "Thank you",
    );
    await expect(page.getByRole("textbox", { name: "Return link (optional)" })).toHaveValue(
      "https://shop.example/thanks",
    );
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(clientName);
    await expect(page.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("12.5");
    await expect(page.locator('input[name="dueDate"]')).toHaveValue("");
    await expect(page.locator('input[name="supplyDate"]')).toHaveValue("");
    await expect(page.getByRole("textbox", { name: "Agreed amount" })).toHaveValue("1150.5");
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: invoice.number })).toBeVisible();
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

    // Back in the list, newest first; the client's PO number finds the invoice (R-90).
    await page.getByRole("link", { name: "Invoices" }).first().click();
    await page.getByRole("main").getByRole("searchbox", { name: "Search invoices" }).fill(po);
    await expect(page.getByRole("row")).toHaveCount(2);
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
    await page.getByRole("textbox", { name: choosing ? "Amount in USD" : "Amount" }).fill("0.5");
    // R-88: the typed amount becomes the first item's price, and the items' total the amount.
    await page.getByRole("button", { name: "Add item" }).click();
    await page.getByRole("textbox", { name: "Item 1", exact: true }).fill("E2E logo");
    await page.getByRole("textbox", { name: "Qty" }).fill("2");
    await expect(page.getByText("Total", { exact: true }).locator("..")).toHaveText(
      choosing ? "Total1.00 USD" : "Total1.00 USDC",
    );
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("E2E phone client");
    await page.getByRole("button", { name: "Add agreed value" }).click();
    await page.getByRole("button", { name: /^Agreed in/ }).click();
    await page.getByRole("combobox", { name: /Agreed in/ }).fill("pound");
    await page.keyboard.press("Enter");
    await page.getByRole("textbox", { name: "Agreed amount" }).fill("0.8");
    await fits();
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
    await expect(page.getByRole("region", { name: "Items" })).toContainText(
      choosing ? "E2E logo2 × 0.50 USD1.00 USD" : "E2E logo2 × 0.50 USDC1.00 USDC",
    );
    // R-94: a client without an email: the page says why the invoice can't be emailed.
    await expect(page.getByRole("region", { name: "Billed to" })).toContainText(
      "No client email on this invoice",
    );
    await fits();
    // R-91: its duplicate's form, items filled in, fits a phone too.
    await page
      .getByRole("main")
      .locator("header")
      .getByRole("button", { name: "More actions" })
      .click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.getByRole("textbox", { name: "Item 1", exact: true })).toHaveValue(
      "E2E logo",
    );
    await fits();
    expect(await blockingViolations(page)).toEqual([]);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: invoice.number })).toBeVisible();
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

test("the overview lists what clients owe, with the total left to pay, and fits a phone", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: session });
  const page = await context.newPage();
  // Overdue first, a payer-chooses one in USD, held money out of the total, and Show all past five.
  const row = (n: number, kind: string, amount: string, more: object = {}) => ({
    kind,
    invoiceId: `0x${String(n).repeat(64)}`,
    number: 9000 + n,
    title: null,
    clientName: `Client ${n}`,
    dueDate: null,
    daysLate: 0,
    optionCount: 1,
    chainId: 84532,
    token: `0x${"a".repeat(40)}`,
    symbol: "USDC",
    decimals: 6,
    amount,
    ...more,
  });
  const items = [
    row(1, "overdue", "450500000", { daysLate: 12, dueDate: "2026-01-01" }),
    row(2, "overdue", "100000000", { daysLate: 1, optionCount: 4 }),
    row(3, "partlyPaid", "25000000"),
    row(4, "partlyPaid", "1000000"),
    row(5, "partlyPaid", "1000000"),
    row(6, "partlyPaid", "1000000"),
    row(7, "held", "9000000"),
  ];
  // R-95, with fixed rows set before the first load: every test signs in as one user, whose API rate limit the
  // suite comes close to, so this test loads the overview once. The API test covers the real answer.
  await page.route("**/api/v1/profiles/*/owed", (route) => route.fulfill({ json: { items } }));
  await page.goto("/app");
  await chooseMerchant(page, () =>
    page
      .locator("aside")
      .getByRole("button", { name: /^Switch profile/ })
      .click(),
  );
  const owed = page.getByRole("region", { name: "Owed to you" });
  await expect(owed.getByText("Left to pay: 578.50 USD")).toBeAttached();
  const links = owed.getByRole("link");
  await expect(links).toHaveCount(5);
  await expect(links.first()).toContainText("Client 1");
  await expect(links.first()).toContainText("INV-9001 · 12 days late");
  await expect(links.first()).toContainText("450.50 USDC");
  await expect(links.first()).toHaveAttribute("href", `/app/invoices/0x${"1".repeat(64)}`);
  await expect(links.nth(1)).toContainText("1 day late");
  await expect(links.nth(1)).toContainText(/100\.00 USD(?!C)/);
  expect(await blockingViolations(page)).toEqual([]);
  await owed.getByRole("button", { name: "Show all 7" }).click();
  await expect(links).toHaveCount(7);
  // The button goes, so focus moves to the first row it showed.
  await expect(links.nth(5)).toBeFocused();
  await expect(links.last()).toContainText("Held for the payer");
  await expect(links.last()).not.toContainText("left to pay");
  await page.setViewportSize({ width: 390, height: 844 });
  // The shell swaps the sidebar for the tab bar after the resize; until then the old layout is wider than a phone.
  await expect(page.locator("aside")).toBeHidden();
  await expect(owed).toBeVisible();
  await expect.poll(() => sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(await blockingViolations(page)).toEqual([]);
  await context.close();
});
