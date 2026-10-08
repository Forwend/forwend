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
  for (const colorScheme of ["light", "dark"] as const) {
    test(`/ has no serious or critical axe violations in the ${colorScheme} theme`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ colorScheme, reducedMotion: "reduce" });
      const page = await context.newPage();
      await page.goto(`${PUBLIC_URL}/`);
      expect(await blockingViolations(page)).toEqual([]);
      await context.close();
    });
  }

  for (const theme of ["light", "dark"]) {
    test(`/kit has no serious or critical axe violations in the ${theme} theme`, async ({
      page,
    }) => {
      // Reduced motion makes the theme change instant, so axe never samples colors mid-transition.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${KIT_URL}/kit`);
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      expect(await blockingViolations(page)).toEqual([]);
    });
  }
});
