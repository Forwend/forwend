import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { sidewaysScroll } from "./sideways";

// R-96: the API answers are mocked; the Go API test covers the real ones.
const TOKEN = "ab".repeat(32);

const blocking = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => v.id);

test.describe("stop reminders page", () => {
  test("asks first, stops on the button and says for which invoice", async ({ page }) => {
    let posts = 0;
    await page.route(`**/api/v1/reminders/${TOKEN}/stop`, (route) => {
      posts++;
      return route.fulfill({ json: { number: 7, from: "Alice Design GmbH" } });
    });
    await page.goto(`/reminders/${TOKEN}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Stop payment reminders?" }),
    ).toBeVisible();
    // Opening the link stops nothing: a mail scanner may open it.
    expect(posts).toBe(0);
    expect(await blocking(page)).toEqual([]);
    await page.getByRole("button", { name: "Stop reminders" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Reminders stopped" })).toBeFocused();
    await expect(page.getByRole("status")).toHaveText(
      "You will get no more payment reminders for INV-0007 from Alice Design GmbH.",
    );
    expect(posts).toBe(1);
    expect(await blocking(page)).toEqual([]);
  });

  test("says when the link stops nothing, and fits a phone", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.route(`**/api/v1/reminders/${TOKEN}/stop`, (route) =>
      route.fulfill({
        status: 404,
        json: { error: { code: "invoice_not_found", message: "invoice not found" } },
      }),
    );
    await page.goto(`/reminders/${TOKEN}`);
    await page.getByRole("button", { name: "Stop reminders" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      /does not stop any reminders/,
    );
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    expect(await blocking(page)).toEqual([]);
    expect((await page.goto("/reminders/not-a-token"))?.status()).toBe(404);
    await context.close();
  });
});
