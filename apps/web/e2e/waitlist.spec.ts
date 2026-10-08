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

    // Visible confirmation inside the pill, plus the same text in the live region for screen readers.
    const confirmation = hero.locator('[data-capture="confirmation"]');
    await expect(hero.locator('p.sr-only[aria-live="polite"]')).toHaveText("You're on the list.");
    await expect(confirmation).toContainText("You're on the list.");
    await expect(confirmation).toContainText("name@example.com");
    await expect(confirmation.locator("svg")).toBeVisible();
    // The confirmation replaces the form: no disabled, greyed-out button is left behind.
    await expect(hero.getByRole("button", { name: "Join waitlist" })).toHaveCount(0);
    const background = await confirmation.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Same height as the form pill, so nothing below moves.
    expect(Math.round((await confirmation.boundingBox())?.height ?? 0)).toBe(54);
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
    await page.waitForTimeout(500);
    expect(requests).toEqual([]);
  });

  test("shows an error for an invalid email and no success", async ({ page }) => {
    await page.goto("/");
    const hero = page.locator('[data-section="hero"]');
    await hero.getByLabel("Email address").fill("abc");
    await hero.getByRole("button", { name: "Join waitlist" }).click();

    const error = hero.locator('p[id$="-error"]');
    await expect(error).toContainText("Enter a full email address");
    await expect(hero.locator('p.sr-only[aria-live="polite"]')).toContainText(
      "Enter a full email address",
    );
    await expect(error).toBeVisible();
    // The error sits on a solid surface, never directly on the landscape.
    expect(await error.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
      "rgba(0, 0, 0, 0)",
    );
    await expect(hero.getByText("You're on the list.", { exact: false })).toHaveCount(0);
    await expect(hero.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");
  });
});

test("the email field paints over the browser autofill tint with the surface color", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.locator('[data-section="hero"] input[type="email"]');
  // Real autofill cannot be triggered from a test; check the rule that overrides it is present.
  const rule = await page.evaluate(() =>
    [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map((r) => r.cssText);
        } catch {
          return [];
        }
      })
      .find((text) => text.includes(":autofill") && text.includes("--fw-surface")),
  );
  expect(rule, "an :autofill rule using --fw-surface").toBeTruthy();
  const box = await input.boundingBox();
  const pill = await input.locator("..").boundingBox();
  expect(box && pill && pill.height - (box?.height ?? 0)).toBeLessThanOrEqual(14);
});
