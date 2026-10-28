import { expect, type Page, test } from "@playwright/test";
import { sidewaysScroll } from "../sideways";
import { blockingViolations } from "./axe";
import { session } from "./session";

// Made once for the test account, then reused: each profile gets a real Privy wallet.
// `open` shows the profile choices: the sidebar menu on desktop, the sheet on phones.
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

// Returns null when this database has no enabled network.
async function createInvoice(page: Page, fill: () => Promise<void>) {
  await expect(page.getByRole("heading", { level: 1, name: "New invoice" })).toBeVisible();
  const noNetworks = page.getByText("No networks are enabled yet");
  const form = noNetworks.or(page.getByRole("button", { name: "Create invoice" }));
  // R-92: billing details are saved once, before the profile's first invoice.
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
  const recipient = page.getByRole("textbox", { name: "Name", exact: true });
  const recipientEmail = page.getByRole("textbox", { name: "Email", exact: true });
  if (!(await recipient.inputValue()) && !(await recipientEmail.inputValue()))
    await recipient.fill("E2E individual customer");
  const created = page.waitForResponse(
    (r) => /\/api\/v1\/profiles\/[^/]+\/invoices$/.test(r.url()) && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create invoice" }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const body = (await response.json()) as {
    invoiceId: string;
    payToken: string;
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
    sidebar.getByRole("button", { name: /^Switch profile: E2E shop Merchant/ }),
  ).toBeVisible();

  await sidebar.getByRole("link", { name: "Invoices" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Invoices" })).toBeVisible();
  await expect(page.getByRole("table").or(page.getByText("No invoices yet"))).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  const isMerchant = async (p: Page) => {
    const aside = p.locator("aside");
    await expect(
      aside.getByRole("button", { name: /^Switch profile: E2E shop Merchant/ }),
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

  // R-86
  const clientName = `E2E client ${Date.now()}`;
  const po = `PO-${Date.now()}`;
  await sidebar.getByRole("link", { name: "Clients" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Clients" })).toBeAttached();
  expect(await blockingViolations(page)).toEqual([]);
  await page.getByRole("link", { name: "Add client" }).first().click();
  await expect(page).toHaveURL("/app/clients/new");
  await page.getByRole("textbox", { name: "Name or business name" }).fill(clientName);
  // Resend's test inbox, so an email from a test never reaches a real person.
  await page
    .getByRole("textbox", { name: "Billing email (optional)" })
    .fill("delivered@resend.dev");
  await page.getByRole("textbox", { name: "Address (optional)" }).fill("1 Test Street\nBerlin");
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
  // R-97
  await page
    .getByRole("checkbox", { name: "Start new invoices with payment reminders on" })
    .check();
  expect(await blockingViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Save client" }).click();
  await expect(page).toHaveURL("/app/clients");
  const clientRow = page.getByRole("row").filter({ hasText: clientName });
  await expect(clientRow).toContainText("delivered@resend.dev");
  await expect(clientRow).toContainText("Germany");
  await expect(clientRow).toContainText("DE123456789");
  expect(await blockingViolations(page)).toEqual([]);

  // R-134: the first store came with the profile; the return link below must start with one of its origins. A
  // second store with its own close is made once and reused: a profile has at most 20.
  await sidebar.getByRole("link", { name: "Stores" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Stores" })).toBeAttached();
  expect(await blockingViolations(page)).toEqual([]);
  const popUp = page.getByRole("row").filter({ hasText: "E2E pop-up" });
  if ((await popUp.count()) === 0) {
    await page.getByRole("link", { name: "Add store" }).first().click();
    await expect(page).toHaveURL("/app/stores/new");
    await page.getByRole("textbox", { name: "Store name" }).fill("E2E pop-up");
    await page.getByRole("combobox", { name: "Checkout closes after" }).click();
    await page.getByRole("option", { name: "1 hour" }).click();
    await page
      .getByRole("textbox", { name: "Allowed origins (optional)" })
      .fill("https://popup.example");
    expect(await blockingViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Save store" }).click();
    await expect(page).toHaveURL("/app/stores");
  }
  await expect(popUp).toContainText("1 hour");
  await page.getByRole("row").nth(1).getByRole("link").click();
  await expect(page).toHaveURL(/\/app\/stores\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("textbox", { name: "Store name" })).toHaveValue("E2E shop");
  await page.getByRole("button", { name: "Copy project ID" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    page.url().split("/").at(-1),
  );
  const origins = page.getByRole("textbox", { name: "Allowed origins (optional)" });
  await origins.fill("https://shop.example/thanks");
  await page.getByRole("button", { name: "Save store" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "without a path" })).toBeVisible();
  await expect(origins).toBeFocused();
  await origins.fill("https://shop.example");
  // R-135: the logo uploads at once; the color saves with the store. Any PNG will do: a screenshot of a corner.
  await page.locator('input[type="file"]').setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: await page.screenshot({ clip: { x: 0, y: 0, width: 120, height: 40 } }),
  });
  await expect(page.getByText("Logo saved")).toBeVisible();
  await expect(page.getByRole("img", { name: "E2E shop logo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace logo" })).toBeVisible();
  await page.getByRole("textbox", { name: "Accent color (optional)" }).fill("#1F6A8C");
  // R-136: the store narrows the profile's tokens; Base Sepolia, used below, stays on.
  await expect(page.getByRole("checkbox", { name: "USDC on Base Sepolia" })).toBeChecked();
  expect(await blockingViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Save store" }).click();
  await expect(page).toHaveURL("/app/stores");
  await expect(page.getByRole("row").nth(1)).toContainText("https://shop.example");

  await sidebar.getByRole("link", { name: "Invoices" }).click();
  await page.getByRole("link", { name: "New invoice" }).first().click();

  const title = `E2E ${Date.now()}`;
  let due = "";
  let supplied = "";
  let lastDue = "";
  const invoice = await createInvoice(page, async () => {
    await fixUsdcOnBase(page);
    // R-134: the first store is picked with its close, and another store brings its own.
    const store = page.getByRole("combobox", { name: "Store" });
    await expect(store).toContainText("E2E shop");
    await expect(page.getByRole("radio", { name: "7 days" })).toBeChecked();
    await store.click();
    await page.getByRole("option", { name: "E2E pop-up" }).click();
    await expect(page.getByRole("radio", { name: "1 hour" })).toBeChecked();
    await store.click();
    await page.getByRole("option", { name: "E2E shop" }).click();
    await expect(page.getByRole("radio", { name: "7 days" })).toBeChecked();
    // An amount the token can't hold and a link that is not https.
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
    await link.fill("https://elsewhere.example/thanks");
    await page.getByRole("button", { name: "Create invoice" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "one of this store's allowed origins" }),
    ).toBeVisible();
    await amount.fill("12.5");
    await link.fill("https://shop.example/thanks");
    await page.getByRole("textbox", { name: "Title (optional)" }).fill(title);
    await page.getByRole("textbox", { name: "Note to the client (optional)" }).fill("Thank you");
    // R-89
    await page.getByRole("button", { name: /^Supply date \(optional\)/ }).click();
    await page.keyboard.press("PageUp");
    await page.keyboard.press("Enter");
    supplied = await page.locator('input[name="supplyDate"]').inputValue();
    expect(supplied).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // R-59
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
    // R-90
    await expect(page.getByRole("textbox", { name: "PO or reference (optional)" })).toHaveValue(po);
    await expect(page.getByRole("checkbox", { name: "Send payment reminders" })).toBeChecked();
    // R-99: a retainer; the test stops it below, so no run leaves one running (D-85).
    await page.getByRole("checkbox", { name: "Repeat every month" }).check();
    // A last due date two months on caps a retainer that a failed run leaves running.
    await page.getByRole("button", { name: /^Last due date \(optional\)/ }).click();
    await page.keyboard.press("PageDown");
    await page.keyboard.press("PageDown");
    await page.keyboard.press("Enter");
    lastDue = await page.locator('input[name="repeatEndDate"]').inputValue();
    expect(lastDue > due).toBe(true);
    // R-93
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
    await expect(page.getByRole("heading", { level: 1, name: invoice.number })).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();
    const amount = page.getByRole("region", { name: "Amount" });
    await expect(amount).toContainText("12.50 USDC");
    await expect(amount.getByText("Waiting for payment", { exact: true })).toBeVisible();
    await expect(amount.getByRole("link", { name: "View payment", exact: true })).toHaveAttribute(
      "href",
      `/app/payments/${invoice.invoiceId}`,
    );
    const details = page.getByRole("region", { name: "Details" });
    await expect(details).toContainText("Due date");
    await expect(details).toContainText(dueText);
    await expect(details.locator("div").filter({ hasText: /^Supply date/ })).toContainText(
      new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(`${supplied}T00:00:00Z`),
      ),
    );
    await expect(details.locator("div").filter({ hasText: /^Reference/ })).toContainText(po);
    await expect(details.locator("div").filter({ hasText: /^Store/ })).toContainText("E2E shop");
    await expect(details.locator("div").filter({ hasText: /^Agreed value/ })).toContainText(
      "€1,150.50",
    );
    await expect(details).toContainText("Checkout closes");
    // R-60
    await expect(page.getByRole("main").locator("header [data-status]")).toHaveCount(0);
    await expect(page.getByRole("main").locator("header")).not.toContainText("Checkout closes");
    // R-143: Base Sepolia is a testnet.
    await expect(page.getByRole("main").locator("header")).toContainText("Testnet");
    const client = page.getByRole("region", { name: "Billed to" });
    await expect(client).toContainText(clientName);
    await expect(client).toContainText("delivered@resend.dev");
    await expect(client).toContainText("Germany");
    await expect(client).toContainText("Tax ID DE123456789");
    // R-94. The send is mocked: every run uses this one profile, whose 20 sends a day would run out (D-85).
    const owned = `**/api/v1/profiles/*/invoices/${invoice.invoiceId}`;
    const queued = { requestedAt: new Date().toISOString(), sentAt: null, failedAt: null };
    await page.route(`${owned}/send`, async (route) => {
      const url = route
        .request()
        .url()
        .replace(/\/send$/, "");
      const response = await route.fetch({ url, method: "GET" });
      // From now on the owner's reads list the send, as the API's would.
      await page.route(`${owned}**`, async (read) => {
        const answer = await read.fetch();
        await read.fulfill({
          response: answer,
          json: { ...(await answer.json()), sends: [queued] },
        });
      });
      await route.fulfill({ status: 201, json: { ...(await response.json()), sends: [queued] } });
    });
    const sent = page.waitForRequest(
      (r) => r.url().endsWith(`/invoices/${invoice.invoiceId}/send`) && r.method() === "POST",
    );
    await client.getByRole("button", { name: "Send to client" }).click();
    // The API turns away a send without its key; the mock doesn't, so the key is checked here.
    expect(await (await sent).headerValue("idempotency-key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    await expect(
      page.getByText(`${invoice.number} is on its way to delivered@resend.dev`),
    ).toBeVisible();
    await expect(client).toContainText("Sending to delivered@resend.dev");
    await expect(client.getByRole("button", { name: "Send to client" })).toHaveCount(0);
    await expect(client.getByText(/^You can send it again after/)).toBeFocused();
    expect(await blockingViolations(page)).toEqual([]);
    // R-96, R-97. The due date is a month away and the checkout closes tomorrow, so no reminder goes.
    const reminders = client.getByRole("switch", { name: "Payment reminders" });
    await expect(reminders).toBeChecked();
    await expect(client).toContainText("Emails the client 3 days before the due date");
    await reminders.click();
    await expect(page.getByText("Payment reminders off")).toBeVisible();
    await expect(reminders).not.toBeChecked();
    await reminders.click();
    await expect(page.getByText("Payment reminders on")).toBeVisible();
    await expect(reminders).toBeChecked();
    expect(await blockingViolations(page)).toEqual([]);
    // R-99
    await expect(client).toContainText("Repeats every month");
    await expect(client).toContainText(/Next invoice due .+, emailed to the client on /);
    await expect(client).toContainText(
      `No invoice is due after ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${lastDue}T00:00:00Z`))}.`,
    );
    await client.getByRole("button", { name: "Stop repeating" }).click();
    const stopDialog = page.getByRole("dialog", { name: "Stop repeating?" });
    expect(await blockingViolations(page)).toEqual([]);
    await stopDialog.getByRole("button", { name: "Stop repeating" }).click();
    await expect(page.getByText("Stopped repeating", { exact: true })).toBeVisible();
    await expect(client.getByText(/^Stopped on /)).toBeFocused();
    await expect(client.getByRole("button", { name: "Stop repeating" })).toHaveCount(0);
    expect(await blockingViolations(page)).toEqual([]);
    const link = `http://localhost:3000/pay/${invoice.payToken}`;
    await page
      .getByRole("main")
      .locator("header")
      .getByRole("button", { name: "More actions" })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Open pay page in a new tab" }),
    ).toHaveAttribute("href", `${link}?preview=1`);
    await page.getByRole("menuitem", { name: "Copy link" }).click();
    await expect(page.getByRole("menuitem", { name: "Link copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await page.keyboard.press("Escape");
    // R-91
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
    // R-97, R-99
    await expect(page.getByRole("checkbox", { name: "Send payment reminders" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Repeat every month" })).not.toBeChecked();
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: invoice.number })).toBeVisible();
    const pdf = (name: string) => details.getByRole("link", { name });
    const read = `/api/v1/profiles/*/invoices/${invoice.invoiceId}`;
    const pdfPath = (file: string) => `/api/v1/invoices/${invoice.payToken}/${file}`;
    await expect(pdf("Invoice PDF")).toHaveAttribute("href", pdfPath("invoice.pdf"));
    const file = await page.request.get(pdfPath("invoice.pdf"));
    expect([file.status(), file.headers()["content-type"]]).toEqual([200, "application/pdf"]);
    // R-135: the store's logo is the PDF's one image (its QR code is drawn), and every read carries the brand.
    expect((await file.body()).includes("/Subtype /Image")).toBe(true);
    const publicRead = await (
      await page.request.get(`/api/v1/invoices/${invoice.payToken}`)
    ).json();
    expect(publicRead.brand).toMatchObject({ color: "#1f6a8c" });
    expect(publicRead.brand.logoAt).not.toBeNull();
    await expect(pdf("Receipt PDF")).toHaveCount(0);
    expect(await blockingViolations(page)).toEqual([]);
    await page.route(`**${read}**`, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), paymentStatus: "paid" },
      });
    });
    await page.reload();
    await expect(pdf("Receipt PDF")).toHaveAttribute("href", pdfPath("receipt.pdf"));
    await page.unroute(`**${read}**`);

    // A payment to an option the client did not end up paying with is listed apart, as held for the payer (F143).
    const heldTx = `0x${"4".repeat(64)}`;
    await page.route(`**/api/v1/**/payments/${invoice.invoiceId}**`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const original = body.options[0];
      const held = {
        ...original,
        optionId: `0x${"5".repeat(64)}`,
        chainId: 421614,
        network: "arbitrum-sepolia",
        token: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
        symbol: "USDC",
        decimals: 6,
        amount: body.amount,
        receiveAddress: `0x${"6".repeat(40)}`,
        amounts: { ...original.amounts, receiver: "2000000", payable: "0", held: "2000000" },
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
            paid: "0",
            blocksLeft: 0,
            blocksTotal: 0,
            secondsLeft: 0,
          },
        ],
      };
      await route.fulfill({
        response,
        json: {
          ...body,
          optionLocked: true,
          options: [...body.options, held],
          problems: [
            {
              code: "held_funds",
              action: "review_funds",
              optionId: held.optionId,
              amount: "2000000",
              asset: {
                chainId: held.chainId,
                token: held.token,
                symbol: held.symbol,
                decimals: held.decimals,
              },
              endpointId: null,
              eventId: null,
              reason: "other_option",
            },
          ],
        },
      });
    });
    await page.getByRole("link", { name: "View payment", exact: true }).click();
    await expect(
      page.getByRole("main").getByText("Money held for the payer", { exact: false }),
    ).toContainText("2.00");
    await expect(page.getByRole("link", { name: "View transaction on Arbiscan" })).toHaveAttribute(
      "href",
      `https://sepolia.arbiscan.io/tx/${heldTx}`,
    );
    expect(await blockingViolations(page)).toEqual([]);
    await page.unroute(`**/api/v1/**/payments/${invoice.invoiceId}**`);

    // R-90
    await page.getByRole("link", { name: "Invoices" }).first().click();
    await page.getByRole("main").getByRole("searchbox", { name: "Search invoices" }).fill(po);
    await expect(page.getByRole("row")).toHaveCount(2);
    const row = page.getByRole("row").filter({ hasText: invoice.number });
    await expect(row).toContainText(`${title} · E2E shop`);
    await expect(row).toContainText(clientName);
    await expect(row).toContainText(dueText);
    await expect(row).toContainText("12.50 USDC");
    await expect(row).toContainText("Waiting for payment");
    await row.getByRole("link", { name: invoice.number }).click();
    await expect(page.getByRole("heading", { level: 1, name: invoice.number })).toBeVisible();
  }

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
    await more.getByRole("button", { name: /Switch profile$/ }).click();
  });
  await tabs.getByRole("button", { name: "More" }).click();
  await expect(more.getByRole("link", { name: "Activity", exact: true })).toBeVisible();
  await expect(more.getByRole("link", { name: "Billing details", exact: true })).toBeVisible();
  // R-86
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
    // Its addresses stop counting toward the shared profile's open cap within the hour (D-85).
    await page.getByText("1 hour", { exact: true }).click();
    // R-88
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
    // R-94
    await expect(page.getByRole("region", { name: "Billed to" })).toContainText(
      "No client email on this invoice",
    );
    await fits();
    // R-91
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
    // A checkout has no invoice number: its reference names it, and its row opens the payment.
    row(7, "partlyPaid", "2000000", { number: null, clientName: null, reference: "order-7" }),
    // Held money is the payer's (D-114): an older API's held row never shows here.
    row(8, "held", "9000000"),
  ];
  // R-95. Mocked before the first load: the suite nears the one test user's API rate limit, so this loads once.
  await page.route("**/api/v1/profiles/*/owed", (route) => route.fulfill({ json: { items } }));
  await page.goto("/app");
  await chooseMerchant(page, () =>
    page
      .locator("aside")
      .getByRole("button", { name: /^Switch profile/ })
      .click(),
  );
  const owed = page.getByRole("region", { name: "Owed to you" });
  await expect(owed.getByText("Left to pay: 580.50 USD")).toBeAttached();
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
  await expect(links.nth(5)).toBeFocused();
  await expect(links.last()).toContainText("order-7");
  await expect(links.last()).toContainText("Partially paid");
  await expect(links.last()).toHaveAttribute("href", `/app/payments/0x${"7".repeat(64)}`);
  await expect(owed.getByText("Held for the payer")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  // The shell swaps the sidebar for the tab bar after the resize; until then the old layout is wider than a phone.
  await expect(page.locator("aside")).toBeHidden();
  await expect(owed).toBeVisible();
  await expect.poll(() => sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(await blockingViolations(page)).toEqual([]);
  await context.close();
});
