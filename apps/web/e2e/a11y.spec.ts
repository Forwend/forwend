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

  for (const colorScheme of ["light", "dark"] as const) {
    // The theme comes from the system preference through the head script, as for a real visitor;
    // setting data-theme by hand after load raced with hydration and made this test flaky.
    test(`/kit has no serious or critical axe violations in the ${colorScheme} theme`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ colorScheme, reducedMotion: "reduce" });
      const page = await context.newPage();
      await page.goto(`${KIT_URL}/kit`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      expect(await blockingViolations(page)).toEqual([]);
      // R-59: an open date picker, its calendar grid and the keyboard path into it.
      await page.getByRole("button", { name: /^Due date \(optional\)/ }).click();
      const grid = page.getByRole("grid", { name: "Due date (optional)" });
      await expect(grid.locator("button[tabindex='0']")).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      await expect(grid).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /^Due date \(optional\) Nov 3, 2026/ }),
      ).toBeFocused();
      await page.getByRole("button", { name: /^Due date \(optional\)/ }).click();
      expect(await blockingViolations(page)).toEqual([]);
      await context.close();
    });
  }

  for (const colorScheme of ["light", "dark"] as const) {
    test(`/sign-in has no serious or critical axe violations in the ${colorScheme} theme`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ colorScheme, reducedMotion: "reduce" });
      const page = await context.newPage();
      await page.goto(`${PUBLIC_URL}/sign-in`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await blockingViolations(page)).toEqual([]);
      await context.close();
    });
  }
});
