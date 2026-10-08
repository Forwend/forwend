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
