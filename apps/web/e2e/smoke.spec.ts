import { expect, test } from "@playwright/test";

test("home page loads with the Forwend title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Forwend/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("an unknown URL returns 404 with a way back home", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This path ends here.");
  await page.getByRole("link", { name: "Back to Forwend" }).click();
  await expect(page).toHaveURL("/");
});

test("page titles use the 'Forwend | …' format", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/^Forwend \| /);
  await page.goto("/no-such-page");
  await expect(page).toHaveTitle("Forwend | Page not found");
});

test("pages can't be framed by another site and carry the security headers", async ({
  request,
}) => {
  for (const path of ["/", "/sign-in", "/app", `/pay/0x${"1".repeat(64)}`]) {
    const headers = (await request.get(path)).headers();
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(headers["x-powered-by"], path).toBeUndefined();
  }
});
