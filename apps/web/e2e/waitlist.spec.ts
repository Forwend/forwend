import { expect, test } from "@playwright/test";

test.describe("mock waitlist", () => {
  test("confirms a valid email without starting any network request", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const requests: string[] = [];
    page.on("request", (request) => requests.push(`${request.method()} ${request.url()}`));

    const hero = page.locator('[data-section="hero"]');
    await hero.getByLabel("Email address").fill("name@example.com");
    await hero.getByRole("button", { name: "Join waitlist" }).click();

    await expect(hero.getByText("You're on the list.", { exact: false })).toBeVisible();
    await page.waitForTimeout(500);
    expect(requests).toEqual([]);
  });

  test("shows an error for an invalid email and no success", async ({ page }) => {
    await page.goto("/");
    const hero = page.locator('[data-section="hero"]');
    await hero.getByLabel("Email address").fill("abc");
    await hero.getByRole("button", { name: "Join waitlist" }).click();

    await expect(hero.getByText("Enter a full email address", { exact: false })).toBeVisible();
    await expect(hero.getByText("You're on the list.", { exact: false })).toHaveCount(0);
    await expect(hero.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");
  });
});
