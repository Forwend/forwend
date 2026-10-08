import { expect, test } from "@playwright/test";
import { KIT_URL, PUBLIC_URL } from "./servers";

test.describe("/kit/directions", () => {
  test("shows three labeled hero comps, each with a headline, a primary button and a product panel", async ({
    page,
  }) => {
    await page.goto(`${KIT_URL}/kit/directions`);
    const labels = ["A Dawn Path", "B Dusk Ledger", "C Halftone Horizon"];
    for (const [i, id] of ["dawn-path", "dusk-ledger", "halftone-horizon"].entries()) {
      const comp = page.getByTestId(`direction-${id}`);
      await expect(comp.getByRole("heading", { level: 2 })).toHaveText(labels[i] ?? "");
      await expect(comp.getByRole("heading", { level: 3 })).toBeVisible();
      await expect(comp.getByRole("button", { name: "Join waitlist" })).toBeVisible();
      await expect(comp.getByTestId("product-panel")).toBeVisible();
    }
  });

  test("is not indexed", async ({ page }) => {
    await page.goto(`${KIT_URL}/kit/directions`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("returns 404 when KIT_ENABLED is not set", async ({ request }) => {
    const response = await request.get(`${PUBLIC_URL}/kit/directions`);
    expect(response.status()).toBe(404);
  });
});

test.describe("/kit theme switch", () => {
  test("switches <html> to dark and back, changing the body background", async ({ page }) => {
    await page.goto(`${KIT_URL}/kit`);
    const html = page.locator("html");
    const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await expect(html).toHaveAttribute("data-theme", "light");
    const light = await bodyBg();

    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect.poll(bodyBg).not.toBe(light);

    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect.poll(bodyBg).toBe(light);
  });
});
