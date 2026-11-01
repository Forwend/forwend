import { expect, test } from "@playwright/test";

test.describe("landing entry", () => {
  test("opens sign-in without collecting an email on the landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('input[type="email"]')).toHaveCount(0);

    const hero = page.locator('[data-section="hero"]');
    await hero.getByRole("link", { name: "Open Forwend", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
