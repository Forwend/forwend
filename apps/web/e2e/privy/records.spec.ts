import { expect, test } from "@playwright/test";
import { sidewaysScroll } from "../sideways";
import { blockingViolations } from "./axe";
import { mockApi } from "./sample-api";
import { session } from "./session";

// R-109: on fixed answers, the Transactions page says what each transaction was, takes a label for money in that
// Forwend can't classify, and exports the days chosen. Nothing is saved on the shared account (D-85).
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
  // List reads that start after a label is saved.
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
  await expect(table.getByRole("link", { name: /^INV-\d{4}/ }).first()).toBeVisible();
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
  // The list is read again after the label is saved.
  await expect.poll(() => readsAfterLabel).toBeGreaterThan(0);
  expect(await blockingViolations(page)).toEqual([]);

  await main.getByRole("button", { name: "Export CSV" }).click();
  const dialog = page.getByRole("dialog", { name: "Export transactions" });
  await dialog.getByLabel("From").fill("2026-10-01");
  expect(await blockingViolations(page)).toEqual([]);
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download CSV" }).click();
  expect((await download).suggestedFilename()).toBe("forwend-transactions.csv");
  await expect(dialog).toBeHidden();

  // On a phone the type sits under each row.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    main.getByRole("combobox", { name: /^Type of [\d.,]+ USDC in from 0x01/ }),
  ).toBeVisible();
  await expect.poll(() => sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(await blockingViolations(page)).toEqual([]);

  // The overview's preview (Payments on a business profile) keeps its columns, with no type.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  const recent = page.getByRole("region", { name: "Payments", exact: true });
  await expect(recent.getByRole("columnheader", { name: "Transaction" })).toBeVisible();
  await expect(recent.getByRole("columnheader", { name: "Type" })).toHaveCount(0);
  await expect(recent.getByRole("combobox")).toHaveCount(0);
  await context.close();
});
