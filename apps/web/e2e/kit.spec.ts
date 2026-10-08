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
      await expect(comp.getByRole("img", { name: /Generated hero candidate/ })).toBeVisible();
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

test.describe("/kit", () => {
  test("shows every foundation and component section and is not indexed", async ({ page }) => {
    await page.goto(`${KIT_URL}/kit`);
    for (const title of [
      "Colors",
      "Typography",
      "Spacing",
      "Radius",
      "Shadows",
      "Motion",
      "Icons",
      "Components",
      "Payment components",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
    }
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("returns 404 when KIT_ENABLED is not set", async ({ request }) => {
    const response = await request.get(`${PUBLIC_URL}/kit`);
    expect(response.status()).toBe(404);
  });
});

test.describe("interaction states on /kit", () => {
  test("buttons show hover, keyboard focus and a distinct disabled state", async ({ page }) => {
    await page.goto(`${KIT_URL}/kit`);
    const style = (el: import("@playwright/test").Locator, prop: string) =>
      el.evaluate((node, p) => getComputedStyle(node).getPropertyValue(p), prop);

    const primary = page.getByRole("button", { name: "Size md" });
    const resting = await style(primary, "background-color");
    await primary.hover();
    await expect.poll(() => style(primary, "background-color")).not.toBe(resting);

    await page.mouse.move(0, 0);
    await primary.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(primary).toBeFocused();
    expect(await style(primary, "outline-style")).toBe("solid");
    expect(Number.parseFloat(await style(primary, "outline-width"))).toBeGreaterThanOrEqual(2);

    const disabled = page.getByRole("button", { name: "Disabled" }).first();
    await expect(disabled).toBeDisabled();
    expect(await style(disabled, "background-color")).not.toBe(resting);
  });

  test("a loading button keeps its colors and is marked busy", async ({ page }) => {
    await page.goto(`${KIT_URL}/kit`);
    const loading = page.getByRole("button", { name: "Saving" });
    await expect(loading).toHaveAttribute("aria-busy", "true");
    const primary = page.getByRole("button", { name: "Size md" });
    const bg = (el: import("@playwright/test").Locator) =>
      el.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(await bg(loading)).toBe(await bg(primary));
  });

  test("text fields show a focus ring", async ({ page }) => {
    await page.goto(`${KIT_URL}/kit`);
    const field = page.getByLabel("Invoice amount");
    const before = await field.evaluate((n) => getComputedStyle(n).boxShadow);
    await field.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(field).toBeFocused();
    await expect.poll(() => field.evaluate((n) => getComputedStyle(n).boxShadow)).not.toBe(before);
  });

  test("tabs mark the active tab", async ({ page }) => {
    await page.goto(`${KIT_URL}/kit`);
    const merchant = page.getByRole("tab", { name: "Merchant" });
    const personal = page.getByRole("tab", { name: "Personal" });
    await merchant.click();
    await expect(merchant).toHaveAttribute("aria-selected", "true");
    const bg = (el: import("@playwright/test").Locator) =>
      el.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(await bg(merchant)).not.toBe(await bg(personal));
  });
});

test("/kit typography shows the role type tokens", async ({ page }) => {
  await page.goto(`${KIT_URL}/kit`);
  const typography = page.locator("section", {
    has: page.getByRole("heading", { name: "Typography", exact: true }),
  });
  for (const token of ["text-hero", "text-section", "text-amount-lg", "text-amount"]) {
    await expect(typography.getByText(token, { exact: true })).toBeVisible();
  }
});
