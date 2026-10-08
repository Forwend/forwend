import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { KIT_URL, PUBLIC_URL } from "./servers";

const BLOCKING = new Set(["serious", "critical"]);

async function blockingViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => BLOCKING.has(v.impact ?? ""))
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
}

test.describe("accessibility", () => {
  test("/ has no serious or critical axe violations", async ({ page }) => {
    await page.goto(`${PUBLIC_URL}/`);
    expect(await blockingViolations(page)).toEqual([]);
  });

  for (const theme of ["light", "dark"]) {
    test(`/kit has no serious or critical axe violations in the ${theme} theme`, async ({
      page,
    }) => {
      await page.goto(`${KIT_URL}/kit`);
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      expect(await blockingViolations(page)).toEqual([]);
    });
  }
});
