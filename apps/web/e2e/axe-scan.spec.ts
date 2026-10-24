import { expect, test } from "@playwright/test";
import { blockingViolations } from "./privy/axe";
import { KIT_URL } from "./servers";

test("the axe scan never reads a toast that times out during it half-faded", async ({ page }) => {
  await page.goto(`${KIT_URL}/kit`);
  // Holds the toast's exit at half opacity for about 4 s, so a read during the scan sees it half-faded. Like the
  // real easing, it starts at full opacity.
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--fw-duration-fast", "4s");
    document.documentElement.style.setProperty("--fw-ease-out", "linear(0, 0.5 1%, 0.5 99%, 1)");
  });
  await page.getByRole("button", { name: "Show toast" }).click();
  await expect(
    page.getByRole("region", { name: "Notifications" }).getByRole("listitem"),
  ).toBeVisible();
  await page.waitForTimeout(5_000 - 100); // TOAST_MS in packages/ui-web: it closes just after the scan starts
  expect(await blockingViolations(page)).toEqual([]);
});
