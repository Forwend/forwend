import { expect, test } from "@playwright/test";

test("home page loads with the Forwend title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Forwend/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Forwend");
});
