import { expect, test } from "@playwright/test";
import { KIT_URL, PUBLIC_URL } from "./servers";

// The kit is internal: it must never be reachable or indexed on the public site.
test.describe("kit privacy", () => {
  for (const path of ["/kit", "/kit/directions"]) {
    test(`${path} returns 404 when KIT_ENABLED is not set`, async ({ request }) => {
      expect((await request.get(`${PUBLIC_URL}${path}`)).status()).toBe(404);
    });

    test(`${path} is not indexed when the kit is on`, async ({ page }) => {
      await page.goto(`${KIT_URL}${path}`);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    });
  }
});

// Touch has no hover: a tap shows a tooltip's text, a second tap or a tap elsewhere hides it.
test("a tap opens a tooltip on a touch screen, and a tap elsewhere closes it", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(`${KIT_URL}/kit`);
  const tip = page.getByRole("tooltip").filter({ hasText: "An estimate in USD" });
  const trigger = page.getByRole("button", { name: "An estimate in USD" });
  await trigger.tap();
  await expect(tip).toBeVisible();
  await page.getByRole("heading", { level: 1 }).first().tap();
  await expect(tip).toBeHidden();
  await trigger.tap();
  await expect(tip).toBeVisible();
  await trigger.tap();
  await expect(tip).toBeHidden();
  await context.close();
});
