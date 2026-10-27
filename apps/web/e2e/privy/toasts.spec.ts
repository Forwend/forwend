import { expect, test } from "@playwright/test";
import { blockingViolations } from "./axe";
import {
  activityItem,
  CONFIRMING_INVOICE,
  hash,
  mockApi,
  OPEN_INVOICE,
  SETTLED_INVOICE,
  TRANSFERS,
} from "./sample-api";
import { session } from "./session";

test("a payment that arrives while the app is open shows one toast, announced to screen readers", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  const events: object[] = [];
  const activity = [
    activityItem(SETTLED_INVOICE),
    activityItem(CONFIRMING_INVOICE, { txHash: hash("d"), status: "detected" }),
    activityItem(OPEN_INVOICE),
  ];
  await mockApi(page, {
    invoices: [CONFIRMING_INVOICE, SETTLED_INVOICE, OPEN_INVOICE],
    activity,
    events,
    transfers: TRANSFERS,
  });
  const loaded = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/events"));
  await page.goto("/app/invoices");
  const region = page.getByRole("region", { name: "Notifications" });
  await loaded;
  await expect(region.getByRole("listitem")).toHaveCount(0);

  // A focus event triggers the next poll.
  events.unshift({
    id: 100,
    kind: "invoice.paid",
    invoiceId: OPEN_INVOICE.invoiceId,
    number: null,
    title: "Order 42",
    chainId: OPEN_INVOICE.chainId,
    token: OPEN_INVOICE.token,
    symbol: "USDC",
    decimals: 6,
    amount: "2000000",
    at: new Date().toISOString(),
  });
  const polled = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/events"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await polled;
  const toast = region.getByRole("listitem");
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText("Payment received");
  await expect(toast).toContainText("2.00 USDC");
  await expect(region.locator("[aria-live='polite']")).toContainText("Payment received");
  expect(await blockingViolations(page)).toEqual([]);

  const again = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/events"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await again;
  await expect(toast).toHaveCount(1);
  await toast.getByRole("button", { name: "Close notification" }).click();
  await expect(toast).toHaveCount(0);
  await context.close();
});
