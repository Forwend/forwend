import { expect, test } from "@playwright/test";

// The waitlist is a mock until the site is public (PLAN C-09): it must never send or store data.
test.describe("mock waitlist", () => {
  test("confirms a valid email without starting any network request", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const requests: string[] = [];
    page.on("request", (request) => requests.push(`${request.method()} ${request.url()}`));

    const hero = page.locator('[data-section="hero"]');
    await hero.getByLabel("Email address").fill("name@example.com");
    await hero.getByRole("button", { name: "Join waitlist" }).click();

    await expect(hero.locator('[data-capture="confirmation"]')).toContainText(
      "You're on the list.",
    );
    await expect(hero.locator('p.sr-only[aria-live="polite"]')).toHaveText("You're on the list.");
    await page.waitForTimeout(500);
    expect(requests).toEqual([]);
  });

  test("shows an error for an invalid email and no confirmation", async ({ page }) => {
    await page.goto("/");
    const hero = page.locator('[data-section="hero"]');
    await hero.getByLabel("Email address").fill("abc");
    await hero.getByRole("button", { name: "Join waitlist" }).click();

    await expect(hero.locator('p[id$="-error"]')).toContainText("Enter a full email address");
    await expect(hero.locator('[data-capture="confirmation"]')).toHaveCount(0);
    await expect(hero.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");
  });
});
