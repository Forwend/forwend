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
