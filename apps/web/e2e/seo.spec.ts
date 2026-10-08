import { expect, test } from "@playwright/test";

test.describe("search metadata", () => {
  test("the home page has a title, a description and a 1200x630 og:image", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Forwend/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /USDC/);
    const og = page.locator('meta[property="og:image"]');
    await expect(og).toHaveCount(1);
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
      "content",
      "1200",
    );
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute(
      "content",
      "630",
    );

    // The tag carries the production origin; fetch the same path from this server.
    const path = new URL((await og.getAttribute("content")) ?? "").pathname;
    const image = await request.get(path);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");
    const png = await image.body();
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  test("the sitemap lists / and not /kit", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    const xml = await response.text();
    expect(xml).toContain("<loc>https://forwend.com/</loc>");
    expect(xml).not.toContain("/kit");
  });

  test("robots.txt exists and keeps /kit out", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain("Disallow: /kit");
    expect(text).toContain("Sitemap: https://forwend.com/sitemap.xml");
  });
});
