import { expect, test } from "@playwright/test";

test.describe("search metadata", () => {
  test("the home page has a title, a description and an og:image", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Forwend/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /stablecoins.*testnet/i,
    );
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
  });

  test("the kit stays out of search: not in the sitemap, disallowed in robots.txt", async ({
    request,
  }) => {
    expect(await (await request.get("/sitemap.xml")).text()).not.toContain("/kit");
    expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /kit");
  });
});
