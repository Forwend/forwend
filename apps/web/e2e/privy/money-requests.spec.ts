import { expect, type Page, test } from "@playwright/test";
import { sidewaysScroll } from "../sideways";
import { blockingViolations } from "./axe";
import { session } from "./session";

// R-71. Returns false when this database has no enabled network.
async function openRequest(page: Page) {
  await page
    .getByRole("region", { name: "Total balance" })
    .getByRole("button", { name: "Request", exact: true })
    .click();
  await expect(page).toHaveURL("/app/invoices/new");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const sheet = page.getByRole("main");
  const noNetworks = sheet.getByText("No networks are enabled yet");
  await expect(noNetworks.or(sheet.getByRole("button", { name: "Continue" }))).toBeVisible();
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

async function createRequest(page: Page) {
  await page.getByRole("main").getByRole("button", { name: "Continue" }).click();
  const created = page.waitForResponse(
    (r) => /\/api\/v1\/profiles\/[^/]+\/invoices$/.test(r.url()) && r.request().method() === "POST",
  );
  await page.getByRole("main").getByRole("button", { name: "Create request" }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const { invoiceId, payToken, number, expiresAt } = (await response.json()) as {
    invoiceId: string;
    payToken: string;
    number: number;
    expiresAt: string;
  };
  await expect(page).toHaveURL(`/app/invoices/${invoiceId}`);
  return { invoiceId, payToken, expiresAt, number: `INV-${String(number).padStart(4, "0")}` };
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
  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByRole("dialog", { name: "Search" });
  await search.getByRole("combobox").fill("request");
  await expect(search.getByRole("option", { name: /^Request money/ })).toBeVisible();
  await page.keyboard.press("Escape");

  if (await openRequest(page)) {
    const sheet = page.getByRole("main");
    const next = sheet.getByRole("button", { name: "Continue" });
    await sheet.getByRole("textbox", { name: "Amount" }).fill("3.25");
    await next.click();
    const name = sheet.getByRole("textbox", { name: "Your name (shown to the payer)" });
    await name.fill("");
    await next.click();
    await expect(
      sheet.getByRole("alert").filter({ hasText: "Enter the name the payer will see." }),
    ).toBeVisible();
    await expect(name).toBeFocused();
    await name.fill("E2E Requester");
    const note = `E2E lunch ${Date.now()}`;
    await sheet.getByRole("textbox", { name: "Note to the payer (optional)" }).fill(note);
    // R-58
    await sheet.getByText("Custom", { exact: true }).click();
    await sheet.getByRole("button", { name: /^Closes on/ }).click();
    await page.keyboard.press("Enter"); // today
    const time = sheet.getByLabel("At", { exact: true });
    await time.fill("00:00");
    // Create checks every step again and opens the one with the first error.
    await next.click();
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

    await expect(page.getByRole("main")).toContainText("3.25");
    const link = `http://localhost:3000/pay/${request.payToken}`;
    // The pay link's actions sit in the header; the link itself never shows.
    await expect(
      page
        .getByRole("main")
        .locator("header")
        .getByRole("link", { name: "Open pay page in a new tab" }),
    ).toHaveAttribute("href", `${link}?preview=1`);
    await page
      .getByRole("main")
      .locator("header")
      .getByRole("button", { name: "Copy link" })
      .click();
    await expect(
      page.getByRole("main").locator("header").getByRole("button", { name: "Link copied" }),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    expect(await blockingViolations(page)).toEqual([]);

    await expect(
      page
        .getByRole("navigation", { name: "Breadcrumb" })
        .getByRole("link", { name: "Requests", exact: true }),
    ).toBeVisible();
    // From is a row of Details.
    await expect(page.getByRole("region", { name: "Details" })).toContainText("E2E Requester");
    await expect(page.getByRole("region", { name: "Billed to" })).toHaveCount(0);
    expect(await blockingViolations(page)).toEqual([]);
    await sidebar.getByRole("link", { name: "Requests", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeAttached();
    // The request's row shows its note.
    await expect(
      page.getByRole("main").locator("tbody tr").filter({ hasText: request.number }),
    ).toContainText(note);
    expect(await blockingViolations(page)).toEqual([]);

    const payer = await browser.newContext({ reducedMotion: "reduce" });
    const pay = await payer.newPage();
    await pay.goto(`/pay/${request.payToken}`);
    await expect(pay.getByRole("heading", { level: 1, name: "E2E Requester" })).toBeVisible();
    await expect(pay.locator("[data-money]")).toHaveText("3.25 USDC");
    await expect(pay.getByText(`Request ${request.number}`)).toBeVisible();
    await pay.getByRole("contentinfo").getByRole("button", { name: "Need help?" }).click();
    await expect(
      pay
        .getByRole("dialog", { name: "Need help?" })
        .getByText("The name at the top is what the recipient gave. Forwend doesn't check it."),
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
  const fits = async () => expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  await page.goto("/app");
  await fits();
  if (await openRequest(page)) {
    const sheet = page.getByRole("main");
    await sheet.getByRole("textbox", { name: "Amount" }).fill("1");
    await sheet.getByRole("button", { name: "Continue" }).click();
    await sheet.getByRole("textbox", { name: "Your name (shown to the payer)" }).fill("E2E Phone");
    // It stops counting toward the shared profile's open cap within the hour (D-85).
    await sheet.getByText("1 hour", { exact: true }).click();
    const request = await createRequest(page);
    // On a phone the pay link's actions are rows under the amount panel.
    await expect(
      page.getByRole("main").getByRole("link", { name: "Open pay page in a new tab" }),
    ).toHaveAttribute("href", new RegExp(`/pay/${request.payToken}\\?preview=1$`));
    await fits();
    expect(await blockingViolations(page)).toEqual([]);
    await expect(page.getByRole("heading", { level: 1, name: request.number })).toBeVisible();
    await expect(page.getByRole("link", { name: "Requests" })).toBeVisible();
    await fits();

    await page.goto(`/pay/${request.payToken}`);
    await expect(page.getByRole("heading", { level: 1, name: "E2E Phone" })).toBeVisible();
    await expect(page.locator("[data-money]")).toHaveText("1.00 USDC");
    await fits();
    expect(await blockingViolations(page)).toEqual([]);
  }
  await context.close();
});
