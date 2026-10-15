import type { Page } from "@playwright/test";

/**
 * How far the page's content reaches past the page's own width: at most 0 when nothing scrolls sideways. Measured
 * against the root element's laid-out width, which leaves out the scrollbar's reserved room (scrollbar-gutter), so
 * that room never reads as overflow and never hides a real one.
 */
export function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      Math.ceil(document.documentElement.getBoundingClientRect().width),
  );
}
