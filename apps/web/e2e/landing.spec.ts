import { expect, test } from "@playwright/test";

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
