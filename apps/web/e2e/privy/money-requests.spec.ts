import { expect, type Page, test } from "@playwright/test";
import { blockingViolations } from "./axe";
import { session } from "./session";

// Opens Request money from the round actions on the personal overview: a page of its own, not a modal (R-71). Waits for
// the form; false when this database has no enabled network: the page then says so.
async function openRequest(page: Page) {
  await page
    .getByRole("region", { name: "Total balance" })
    .getByRole("button", { name: "Request", exact: true })
    .click();
  await expect(page).toHaveURL("/app/invoices/new");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const sheet = page.getByRole("main");
  const noNetworks = sheet.getByText("No networks are enabled yet");
  await expect(noNetworks.or(sheet.getByRole("button", { name: "Create request" }))).toBeVisible();
  if (await noNetworks.isVisible()) {
    expect(await blockingViolations(page)).toEqual([]);
    return false;
  }
  // One token and network, when there is more than one to choose from; other networks may be on locally.
  if (await sheet.getByRole("radio", { name: "One token" }).count())
    await sheet.getByText("One token", { exact: true }).click();
  await sheet.getByRole("combobox", { name: "Network and token" }).click();
  await page.getByRole("option", { name: "USDC · Base Sepolia" }).click();
  return true;
}

// Creates the filled-in request through the API and returns its id and number (INV-0001).
async function createRequest(page: Page) {
  const created = page.waitForResponse(
    (r) => /\/api\/v1\/profiles\/[^/]+\/invoices$/.test(r.url()) && r.request().method() === "POST",
  );
  await page.getByRole("main").getByRole("button", { name: "Create request" }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const { invoiceId, number, expiresAt } = (await response.json()) as {
    invoiceId: string;
    number: number;
    expiresAt: string;
  };
  // The request opens with its pay link.
  await expect(page).toHaveURL(`/app/invoices/${invoiceId}`);
  return { invoiceId, expiresAt, number: `INV-${String(number).padStart(4, "0")}` };
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
    const sheet = page.getByRole("main");
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
    // Custom: a date from the kit calendar and a time; a time too soon is named on the field (R-58).
    await sheet.getByText("Custom", { exact: true }).click();
    await sheet.getByRole("button", { name: /^Closes on/ }).click();
    await page.keyboard.press("Enter"); // today
    const time = sheet.getByLabel("At", { exact: true });
    await time.fill("00:00");
    await sheet.getByRole("button", { name: "Create request" }).click();
    await expect(
      sheet.getByRole("alert").filter({ hasText: "from 15 minutes to 365 days" }),
    ).toBeVisible();
    await sheet.getByRole("button", { name: /^Closes on/ }).click();
    await page.keyboard.press("ArrowRight"); // tomorrow
    await page.keyboard.press("Enter");
    await time.fill("17:00");
    expect(await blockingViolations(page)).toEqual([]);
    const request = await createRequest(page);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(17, 0, 0, 0);
    // The API takes seconds from now, so the close lands within a minute of the time picked.
    expect(Math.abs(Date.parse(request.expiresAt) - tomorrow.getTime())).toBeLessThan(60_000);

    // The request opens with the link to send, and it copies whole.
    await expect(page.getByRole("region", { name: "Amount" })).toContainText("3.25");
    const link = `http://localhost:3000/pay/${request.invoiceId}`;
    const share = page.getByRole("region", { name: "Pay link" });
    await expect(share.locator("p[title]")).toHaveAttribute("title", link);
    await share.getByRole("button", { name: "Copy link" }).click();
    await expect(share.getByRole("button", { name: "Link copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    expect(await blockingViolations(page)).toEqual([]);

    // It sits under Requests and names who asks.
    await expect(
      page
        .getByRole("navigation", { name: "Breadcrumb" })
        .getByRole("link", { name: "Requests", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "From" })).toContainText("E2E Requester");
    await expect(page.getByRole("region", { name: "Billed to" })).toHaveCount(0);
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
    await expect(pay.getByRole("heading", { level: 1, name: "E2E Requester" })).toBeVisible();
    await expect(pay.locator("[data-money]")).toHaveText("3.25 USDC");
    await expect(pay.getByText(`Request ${request.number}`)).toBeVisible();
    // Who asks is the name its creator gave; Need help, in the footer, says Forwend doesn't check it.
    await pay.getByRole("contentinfo").getByRole("button", { name: "Need help?" }).click();
    await expect(
      pay
        .getByRole("dialog", { name: "Need help?" })
        .getByText("The name is what the invoice's creator gave; Forwend doesn't check it."),
    ).toBeVisible();
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
    const sheet = page.getByRole("main");
    await sheet.getByRole("textbox", { name: "Amount" }).fill("1");
    await sheet.getByRole("textbox", { name: "Your name (shown to the payer)" }).fill("E2E Phone");
    const request = await createRequest(page);
    await expect(
      page.getByRole("region", { name: "Pay link" }).locator("p[title]"),
    ).toHaveAttribute("title", new RegExp(`/pay/${request.invoiceId}$`));
    await fits();
    expect(await blockingViolations(page)).toEqual([]);
    await expect(page.getByRole("heading", { level: 1, name: request.number })).toBeVisible();
    await expect(page.getByRole("link", { name: "Requests" })).toBeVisible();
    await fits();

    await page.goto(`/pay/${request.invoiceId}`);
    await expect(page.getByRole("heading", { level: 1, name: "E2E Phone" })).toBeVisible();
    await expect(page.locator("[data-money]")).toHaveText("1.00 USDC");
    await fits();
    expect(await blockingViolations(page)).toEqual([]);
  }
  await context.close();
});
