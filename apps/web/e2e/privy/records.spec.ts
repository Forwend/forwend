import { expect, test } from "@playwright/test";
import { sidewaysScroll } from "../sideways";
import { blockingViolations } from "./axe";
import { mockApi } from "./sample-api";
import { session } from "./session";

// R-109. On mocked answers: nothing is saved on the shared account (D-85).
test("transactions show their type, take a label, and export the days chosen; it fits a phone", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  const labels: { url: string; body: unknown }[] = [];
  let readsAfterLabel = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith("/label"))
      labels.push({ url: r.url(), body: r.postDataJSON() });
    if (r.method() === "GET" && /\/transactions\?/.test(r.url()) && labels.length > 0)
      readsAfterLabel++;
  });
  await page.goto("/app/transactions");
  const main = page.getByRole("main");
  const table = main.getByRole("table");
  await expect(table.getByRole("columnheader", { name: "Type" })).toBeVisible();
  // Transfer 0 paid an invoice, 1 is money in that Forwend can't classify, 3 went out.
  await expect(table.getByRole("link", { name: /INV-\d{4}/ }).first()).toBeVisible();
  await expect(table.getByText("Sent", { exact: true }).first()).toBeVisible();
  await table.getByRole("combobox", { name: /^Type of [\d.,]+ USDC in from 0x01/ }).click();
  await page.getByRole("option", { name: "Income" }).click();
  await expect
    .poll(() => labels)
    .toEqual([
      {
        url: expect.stringMatching(/\/transactions\/84532\/0x019{62}\/0\/label$/),
        body: { label: "income" },
      },
    ]);
  await expect.poll(() => readsAfterLabel).toBeGreaterThan(0);
  expect(await blockingViolations(page)).toEqual([]);

  await main.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export transactions" });
  await dialog.getByLabel("From").fill("2026-10-01");
  expect(await blockingViolations(page)).toEqual([]);
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download CSV" }).click();
  expect((await download).suggestedFilename()).toBe("forwend-transactions.csv");
  await expect(dialog).toBeHidden();

  // R-113
  await main.getByRole("button", { name: "Export", exact: true }).click();
  await dialog.getByLabel("From").fill("2026-10-01");
  await dialog.getByLabel("To").fill("2026-10-31");
  const statement = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download statement (PDF)" }).click();
  expect((await statement).suggestedFilename()).toBe(
    "forwend-statement-2026-10-01-to-2026-10-31.pdf",
  );
  await expect(dialog).toBeHidden();

  // R-111
  await main.getByRole("button", { name: "Export", exact: true }).click();
  const currency = dialog.getByRole("combobox", { name: "Records currency" });
  await expect(currency).toContainText("USD only");
  await currency.click();
  await page.getByRole("option", { name: "EUR · Euro" }).click();
  await expect(currency).toContainText("EUR");
  expect(await blockingViolations(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  const value = table
    .getByRole("button", { name: /^€[\d,]+\.\d{2}, At the ECB rate of Oct 16, 2026$/ })
    .first();
  await expect(value).toBeVisible();
  await value.focus();
  await expect(page.getByRole("tooltip")).toContainText("At the ECB rate of Oct 16, 2026");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    main.getByRole("combobox", { name: /^Type of [\d.,]+ USDC in from 0x01/ }),
  ).toBeVisible();
  await expect(
    main
      .getByRole("listitem")
      .getByRole("button", { name: /^€[\d,]+\.\d{2}, At the ECB rate of/ })
      .first(),
  ).toBeVisible();
  await expect.poll(() => sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(await blockingViolations(page)).toEqual([]);

  // R-113
  await page.route("**/statement.pdf?*", (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: "billing_details_not_found", message: "no billing details" } },
    }),
  );
  await main.getByRole("button", { name: "Export", exact: true }).click();
  await dialog.getByLabel("From").fill("2026-10-01");
  await dialog.getByLabel("To").fill("2026-10-31");
  await dialog.getByRole("button", { name: "Download statement (PDF)" }).click();
  await expect(dialog.getByRole("link", { name: "Add billing details" })).toHaveAttribute(
    "href",
    "/app/billing-details?then=transactions",
  );
  expect(await blockingViolations(page)).toEqual([]);
  await expect.poll(() => sidewaysScroll(page)).toBeLessThanOrEqual(0);
  await dialog.getByRole("link", { name: "Add billing details" }).click();
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page).toHaveURL("/app/transactions");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  // The overview's latest rows are customer payments; wallet transfers stay on Transactions.
  const recent = page.getByRole("region", { name: "Latest payments", exact: true });
  await expect(recent.getByRole("link", { name: /^View all/ })).toHaveAttribute(
    "href",
    "/app/payments",
  );
  await expect(recent.getByRole("columnheader", { name: "Type" })).toHaveCount(0);
  await expect(recent.getByRole("combobox")).toHaveCount(0);
  await context.close();

  // A 44px band takes the tap (DESIGN.md: touch targets).
  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    storageState: session,
  });
  const phone = await touch.newPage();
  await mockApi(phone);
  await phone.goto("/app/transactions");
  await phone.getByRole("main").getByRole("button", { name: "Export", exact: true }).click();
  await phone.getByRole("combobox", { name: "Records currency" }).click();
  await phone.getByRole("option", { name: "EUR · Euro" }).click();
  await phone.getByRole("button", { name: "Cancel" }).click();
  const tap = phone
    .getByRole("main")
    .getByRole("listitem")
    .getByRole("button", { name: /^€/ })
    .first();
  await expect(tap).toBeVisible();
  expect(await tap.evaluate((el) => getComputedStyle(el, "::before").height)).toBe("44px");
  await touch.close();
});
