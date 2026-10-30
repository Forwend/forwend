import { expect, test } from "@playwright/test";
import { blockingViolations } from "./privy/axe";
import { PUBLIC_URL } from "./servers";
import { sidewaysScroll } from "./sideways";

const SECTIONS = [
  "Getting started",
  "API keys",
  "Test mode",
  "Idempotency",
  "Lists and pages",
  "Errors",
  "Metadata",
  "Webhooks",
  "Verifying webhooks",
  "The forwend package",
  "Versioning",
  "Changelog",
];

// R-155: public developer docs, read with no account.
test("/docs explains the API with no sign-in, with its rule for changes and the newest change first", async ({
  page,
}) => {
  await page.goto(`${PUBLIC_URL}/docs`);
  await expect(page).toHaveURL(`${PUBLIC_URL}/docs`);
  await expect(page.getByRole("heading", { level: 1, name: "The Forwend API" })).toBeVisible();
  const contents = page.getByRole("navigation", { name: "On this page" });
  for (const title of SECTIONS) {
    await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
    await expect(contents.getByRole("link", { name: title, exact: true })).toHaveAttribute(
      "href",
      /^#/,
    );
  }
  // A link must look like one: the same color as the text around it is not enough.
  await expect(contents.getByRole("link").first()).toHaveCSS("text-decoration-line", "underline");
  const main = page.getByRole("main");
  for (const fact of [
    "fw_test_",
    "Idempotency-Key",
    "409 idempotency_conflict",
    "nextCursor",
    "422 invalid_value",
    "metadata",
    "invoice.held",
    "webhook-signature",
    "verifyWebhook",
    "at least 90 days before",
  ]) {
    await expect(main.getByText(fact).first()).toBeVisible();
  }
  const dates = await page
    .locator("#changelog ~ ol time")
    .evaluateAll((times) => times.map((t) => t.getAttribute("datetime") ?? ""));
  expect(dates.length).toBeGreaterThan(1);
  expect(dates).toEqual([...dates].sort().reverse());
});

for (const colorScheme of ["light", "dark"] as const) {
  // colorScheme, not a hand-set data-theme: setting it after load races hydration.
  test(`/docs has no serious or critical axe violations in the ${colorScheme} theme`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(`${PUBLIC_URL}/docs`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    expect(await blockingViolations(page)).toEqual([]);
    await context.close();
  });
}

for (const width of [360, 390]) {
  test(`/docs fits a ${width} px phone`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    await page.goto(`${PUBLIC_URL}/docs`);
    await expect(page.getByRole("heading", { level: 2, name: "Verifying webhooks" })).toBeVisible();
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    await context.close();
  });
}

test("the docs page doesn't shift when its fonts arrive late", async ({ page }) => {
  // The font files arrive well after the first paint.
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
