import { expect, test } from "@playwright/test";
import { sidewaysScroll } from "./sideways";

test.describe("theme", () => {
  test("the theme script runs in <head>, before any page content", async ({ request }) => {
    const html = await (await request.get("/")).text();
    expect(html.indexOf('localStorage.getItem("fw-theme")')).toBeGreaterThan(-1);
    expect(html.indexOf('localStorage.getItem("fw-theme")')).toBeLessThan(html.indexOf("<body"));
  });

  for (const scheme of ["dark", "light"] as const) {
    test(`follows a ${scheme} system preference when nothing is saved`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
      await context.close();
    });
  }

  test("the nav toggle switches the theme and the choice survives a reload", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await page.goto("/");
    const nav = page.locator('[data-section="nav"]');
    await nav.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await context.close();
  });
});

test("the phone menu works by keyboard and closes after a destination is chosen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  const nav = page.locator('[data-section="nav"]');
  const toggle = nav.getByRole("button", { name: /^(Open|Close) menu$/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  for (const [name, href] of [
    ["Product", "#product"],
    ["Roadmap", "#roadmap"],
    ["Docs", "/docs"],
    ["Sign in", "/sign-in"],
  ] as const) {
    const link = nav.getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", href);
  }

  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await nav.getByRole("link", { name: "Roadmap", exact: true }).click();
  await expect(page).toHaveURL(/\/#roadmap$/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#roadmap")).toBeInViewport();
});

test("the phone menu expands below the header and dismisses on an outside click", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  const hero = page.locator('[data-section="hero"]');
  const heroTop = await hero.evaluate((element) => element.getBoundingClientRect().top);
  const toggle = page.getByRole("button", { name: /^(Open|Close) menu$/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link", { name: "Docs", exact: true })).toBeVisible();
  await expect
    .poll(() => hero.evaluate((element) => element.getBoundingClientRect().top))
    .toBeGreaterThan(heroTop);
  const headerBounds = await page.locator('[data-section="nav"]').boundingBox();
  const menuBounds = await menu.boundingBox();
  // The menu fills the floating bar inside its 1px border.
  expect(Math.abs((menuBounds?.x ?? 0) - (headerBounds?.x ?? 0))).toBeLessThanOrEqual(1);
  expect((headerBounds?.width ?? 0) - (menuBounds?.width ?? 0)).toBeLessThanOrEqual(2);

  await hero.getByRole("heading", { level: 1 }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toHaveCount(0);
  await expect
    .poll(() => hero.evaluate((element) => element.getBoundingClientRect().top))
    .toBe(heroTop);
});

test("closed phone navigation stays out of keyboard and screen reader navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  const header = page.locator('[data-section="nav"]');
  const toggle = header.getByRole("button", { name: /^(Open|Close) menu$/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toHaveCount(0);
  await expect(header.getByRole("link", { name: "Product", exact: true })).toHaveCount(0);

  await page
    .locator("#landing-mobile-menu a")
    .first()
    .evaluate((link: HTMLAnchorElement) => link.focus());
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.locator('[data-section="hero"]').getByRole("link", { name: "Get started", exact: true }),
  ).toBeFocused();
});

// The R-7 widths, common phones, and both sides of the 40rem and 60rem layout switches.
for (const width of [320, 360, 390, 640, 768, 960, 1024, 1280, 1440, 1536]) {
  test(`the landing page fits a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    await page.locator("#product").scrollIntoViewIfNeeded();
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    const roadmap = page.locator("#roadmap");
    await roadmap.scrollIntoViewIfNeeded();
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  });
}

test("reduced motion leaves content visible without animated movement", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
  const motion = await page.evaluate(() => {
    function isLong(duration: string) {
      const seconds = Number.parseFloat(duration) / (duration.endsWith("ms") ? 1000 : 1);
      return seconds > 0.01;
    }
    return [...document.querySelectorAll("body *")]
      .filter((element) => {
        const style = getComputedStyle(element);
        return (
          (style.animationName !== "none" && style.animationDuration.split(",").some(isLong)) ||
          style.transitionDuration.split(",").some(isLong)
        );
      })
      .map((element) => `${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""}`);
  });
  expect(motion).toEqual([]);
  await expect(page.locator("#roadmap")).toBeVisible();
});

test("the hero dashboard and product sections show live payments on named networks", async ({
  page,
}) => {
  await page.goto("/");
  const dashboard = page.getByRole("img", { name: /^Example Forwend overview/ });
  await expect(dashboard).toBeVisible();
  for (const text of ["Total balance", "18,734.20", "Pending payments", "Received", "My assets"]) {
    await expect(dashboard).toContainText(text);
  }
  // A picture, not controls: nothing inside it takes focus.
  await expect(dashboard.locator("[inert]")).toHaveCount(1);

  const product = page.locator("#product");
  for (const title of [
    "Invoice a client for the work",
    "Share one link, get paid many times",
    "Add checkout to your store",
    "See every step until it is in your wallet",
  ]) {
    await expect(product.getByRole("heading", { level: 2, name: title })).toBeVisible();
  }
  const invoice = product.getByRole("article").filter({ hasText: "Invoice a client" });
  await expect(invoice).toContainText("1,250.00 USDC");
  await expect(invoice).toContainText("Base");
  await expect(invoice).not.toContainText(/Sepolia|Testnet/);
  const status = product.getByRole("article").filter({ hasText: "See every step" });
  for (const step of ["Detected", "Confirmed", "In wallet"])
    await expect(status).toContainText(step);
  await expect(status.getByRole("link", { name: "Networks and tokens" })).toHaveAttribute(
    "href",
    "/docs/reference/networks",
  );
});

test("the hero dashboard and product sections work without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const hero = page.locator('[data-section="hero"]');
  await expect(hero).toContainText("invoices, payment links, and checkout");
  await expect(hero.getByRole("link", { name: "Get started", exact: true })).toHaveAttribute(
    "href",
    "/sign-in",
  );
  await expect(page.getByRole("img", { name: /^Example Forwend overview/ })).toBeVisible();
  const invoice = page.locator("#product").getByRole("article").first();
  await expect(invoice.getByRole("heading", { level: 2 })).toHaveText(
    "Invoice a client for the work",
  );
  await expect(invoice.locator("[data-money]").last()).toHaveText("1,250.00 USDC");
  await expect(invoice).toContainText("Base");
  await context.close();
});

test("unavailable social controls explain themselves without navigating or opening windows", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await footer.scrollIntoViewIfNeeded();
  await footer
    .getByRole("navigation", { name: "Footer" })
    .getByRole("link", { name: "Docs" })
    .focus();
  const initialUrl = page.url();
  const initialPages = context.pages().length;

  for (const name of ["X", "GitHub", "LinkedIn"]) {
    const social = footer.getByRole("button", { name, exact: true });
    await expect(social).toHaveAttribute("aria-disabled", "true");
    expect(await social.getAttribute("disabled")).toBeNull();
    await page.keyboard.press("Tab");
    await expect(social).toBeFocused();
    const hint = page.getByRole("tooltip");
    await expect(hint).toHaveText("Soon...");
    const hintId = await hint.getAttribute("id");
    expect(hintId).toBeTruthy();
    await expect(social).toHaveAttribute("aria-describedby", hintId ?? "");
    await page.keyboard.press("Escape");
    await expect(hint).toHaveCount(0);
    await expect(social).toBeFocused();
    await page.keyboard.press("Enter");
    expect(page.url()).toBe(initialUrl);
    expect(context.pages()).toHaveLength(initialPages);
  }
});

test("social hints work on touch and close on an outside tap", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  const social = footer.getByRole("button", { name: "GitHub", exact: true });
  // aria-disabled suppresses navigation but must still let a touch user discover the hint.
  await social.tap({ force: true });
  await expect(page.getByRole("tooltip")).toHaveText("Soon...");
  await footer.getByRole("heading").tap();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  expect(context.pages()).toHaveLength(1);
  await context.close();
});

test("social hints remain visible when the pointer moves onto them", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("button", { name: "X", exact: true }).hover();
  const hint = page.getByRole("tooltip");
  await expect(hint).toHaveText("Soon...");
  const visibleHint = hint.locator("..");
  await visibleHint.hover();
  await expect(hint).toHaveText("Soon...");
  await page.keyboard.press("Escape");
  await expect(hint).toHaveCount(0);
});
