import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

export async function blockingViolations(page: Page) {
  // Reduced motion makes every fade instant, so a toast that times out mid-scan is never read half-faded.
  const reduced = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  await page.emulateMedia({ reducedMotion: "reduce" });
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
  await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}
