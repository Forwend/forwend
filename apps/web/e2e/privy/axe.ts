import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

export async function blockingViolations(page: Page) {
  // Wait for opening fades before reading colors; skip endless and scroll-driven animations, which never finish.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.timeline === document.timeline)
        .filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY)
        // A menu closing mid-wait cancels its animation; that is not a failure.
        .map((a) => a.finished.catch(() => {})),
    ),
  );
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}
