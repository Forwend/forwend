import { expect, test } from "@playwright/test";
import { mockApi } from "./sample-api";
import { session } from "./session";

test("switching to a list page keeps its rows in place while it loads, and a quick answer shows no placeholder", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  let delay = 1500;
  await page.route(/\/api\/v1\/profiles\/[^/]+\/(invoices|activity)\?/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    await route.fallback();
  });
  await page.goto("/app/payments");
  const main = page.getByRole("main");
  const sidebar = page.locator("aside");
  await expect(main.getByRole("heading", { level: 1 })).toBeAttached();
  await page.evaluate(() => {
    const w = window as unknown as { shift: number };
    w.shift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        w.shift += (entry as unknown as { value: number }).value;
    }).observe({ type: "layout-shift" });
  });
  const placeholder = main.locator("[data-skeleton]").first();
  const opacity = () => placeholder.evaluate((el) => Number(getComputedStyle(el).opacity));
  const firstRow = () => main.locator("tbody tr").first().boundingBox();

  await sidebar.getByRole("link", { name: "Invoices", exact: true }).click();
  await expect(placeholder).toBeAttached();
  expect(await opacity()).toBe(0);
  // Visible once the wait is over; its pulse keeps it between half and full.
  await expect.poll(opacity).toBeGreaterThan(0.4);
  const loading = await firstRow();
  await expect(main.getByRole("row").filter({ hasText: "INV-" }).first()).toBeVisible();
  const loaded = await firstRow();
  // Within a pixel: the collapsed table border can split half a pixel either way.
  expect(Math.abs((loaded?.y ?? 0) - (loading?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(loaded?.height).toBe(loading?.height);
  expect(await page.evaluate(() => (window as unknown as { shift: number }).shift)).toBeLessThan(
    0.01,
  );

  // A quick answer on a list not read yet: the placeholder never becomes visible on any frame.
  delay = 100;
  await page.evaluate(() => {
    const w = window as unknown as { seen: number };
    w.seen = 0;
    const sample = () => {
      for (const el of document.querySelectorAll("main [data-skeleton]"))
        w.seen = Math.max(w.seen, Number(getComputedStyle(el).opacity));
      requestAnimationFrame(sample);
    };
    sample();
  });
  await sidebar.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/activity/);
  await expect(main.locator("[data-skeleton]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { seen: number }).seen)).toBe(0);
  await context.close();

  // A phone with reduced motion: the money list's two-line rows (amount over status) keep their place, and the
  // wait before a placeholder holds without motion.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    storageState: session,
  });
  const small = await phone.newPage();
  await mockApi(small);
  let phoneDelay = 1500;
  await small.route(/\/api\/v1\/profiles\/[^/]+\/(invoices|activity)\?/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, phoneDelay));
    await route.fallback();
  });
  await small.addInitScript(() => {
    const w = window as unknown as { seen: number };
    w.seen = 0;
    const sample = () => {
      for (const el of document.querySelectorAll("main [data-skeleton]"))
        w.seen = Math.max(w.seen, Number(getComputedStyle(el).opacity));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await small.goto("/app/invoices");
  const phoneMain = small.getByRole("main");
  const placeholderRow = phoneMain.locator("[aria-hidden] li").first();
  await expect(placeholderRow).toBeVisible();
  await expect
    .poll(() =>
      placeholderRow
        .locator("[data-skeleton]")
        .first()
        .evaluate((el) => Number(getComputedStyle(el).opacity)),
    )
    .toBe(1);
  const waiting = await placeholderRow.boundingBox();
  const row = phoneMain.getByRole("listitem").filter({ hasText: "INV-" }).first();
  await expect(row).toBeVisible();
  const arrived = await row.boundingBox();
  // Within a pixel: the amount's line mixes two type sizes, which can add one to its line box.
  expect(Math.abs((arrived?.y ?? 0) - (waiting?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((arrived?.height ?? 0) - (waiting?.height ?? 0))).toBeLessThanOrEqual(1);

  phoneDelay = 100;
  await small.goto("/app/activity");
  await expect(phoneMain.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(phoneMain.locator("[data-skeleton]")).toHaveCount(0);
  expect(await small.evaluate(() => (window as unknown as { seen: number }).seen)).toBe(0);
  await phone.close();
});
