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
