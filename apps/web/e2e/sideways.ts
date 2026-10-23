import type { Page } from "@playwright/test";

/** How far content overflows sideways, measured against the root's width so the scrollbar gutter never counts. */
export function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      Math.ceil(document.documentElement.getBoundingClientRect().width),
  );
}
