import { expect, test } from "@playwright/test";
import { blockingViolations } from "./privy/axe";
import { PUBLIC_URL } from "./servers";
import { sidewaysScroll } from "./sideways";

test("public guides preserve nested routes, refresh, history and old anchors", async ({ page }) => {
  await page.goto(`${PUBLIC_URL}/docs`);
  await page.getByRole("link", { name: "Start the quickstart" }).click();
  await expect(page).toHaveURL(`${PUBLIC_URL}/docs/start/first-test-payment`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Your first test payment" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "5. Verify completion on your server" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(`${PUBLIC_URL}/docs`);
  await page.goForward();
  await expect(page).toHaveURL(`${PUBLIC_URL}/docs/start/first-test-payment`);
  await page.goto(`${PUBLIC_URL}/docs#verify`);
  await expect(page).toHaveURL(`${PUBLIC_URL}/docs/integrate/webhooks#verify`);
  await expect(
    page.getByRole("heading", { name: "Verify the unmodified request body" }),
  ).toBeInViewport();
  const response = await page.goto(`${PUBLIC_URL}/docs/unknown-topic`);
  expect(response?.status()).toBe(404);
});

test("documentation search finds fields and returns focus after Escape", async ({ page }) => {
  await page.goto(`${PUBLIC_URL}/docs`);
  const trigger = page.getByRole("button", { name: "Search docs", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true });
  const input = dialog.getByRole("searchbox");
  await expect(input).toBeFocused();
  await input.fill("idempotency_conflict");
  await expect(dialog.getByRole("link").first()).toBeVisible();
  await input.press("ArrowDown");
  await expect(dialog.getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await input.fill("no_such_forwend_topic");
  await expect(dialog.getByText("No matching topics.", { exact: false })).toBeVisible();
  await input.fill("webhook signature");
  const destination = await dialog.getByRole("link").first().getAttribute("href");
  await dialog.getByRole("link").first().click();
  await expect(page).toHaveURL(`${PUBLIC_URL}${destination}`);
  await expect(dialog).not.toBeVisible();
});

test("documentation stays public and articles render without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${PUBLIC_URL}/docs/api/checkout-sessions`);
  await expect(
    page.getByRole("heading", { name: "Create a checkout session", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();
  await expect(page.getByText("invoices.write", { exact: true }).first()).toBeVisible();
  await context.close();
});

test("documentation copy buttons copy plain source", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  await page.goto(`${PUBLIC_URL}/docs/start/first-test-payment`);
  await page.getByRole("button", { name: "Copy code", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("FORWEND_API_URL=");
  expect(text).not.toContain("Copy code");
  await context.close();
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`docs home, guide and API have no serious or critical axe violations in ${colorScheme}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme, reducedMotion: "reduce" });
    const page = await context.newPage();
    for (const route of [
      "/docs",
      "/docs/start/first-test-payment",
      "/docs/api/checkout-sessions",
    ]) {
      await page.goto(`${PUBLIC_URL}${route}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      expect(await blockingViolations(page)).toEqual([]);
    }
    await context.close();
  });
}

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`documentation and wide examples fit at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage();
    for (const route of [
      "/docs",
      "/docs/start/first-test-payment",
      "/docs/api/checkout-sessions",
    ]) {
      await page.goto(`${PUBLIC_URL}${route}`);
      expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    }
    if (width < 960) {
      const trigger = page.getByRole("button", { name: "Navigation", exact: true });
      await trigger.click();
      const drawer = page.getByRole("dialog", { name: "Documentation navigation" });
      await expect(drawer).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await drawer.getByRole("link", { name: "Developer mode", exact: true }).click();
      await expect(page).toHaveURL(`${PUBLIC_URL}/docs/start/test-mode`);
      await expect(drawer).not.toBeVisible();
    }
    await context.close();
  });
}

test("the docs page does not shift when its fonts arrive late", async ({ page }) => {
  await page.route(/\/_next\/static\/media\/.*\.woff2$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fallback();
  });
  await page.addInitScript(() => {
    const w = window as unknown as { shift: number };
    w.shift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        w.shift += (entry as unknown as { value: number }).value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${PUBLIC_URL}/docs`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { shift: number }).shift)).toBeLessThan(
    0.01,
  );
});
