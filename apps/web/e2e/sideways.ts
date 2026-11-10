import type { Page } from "@playwright/test";

/** How far content overflows sideways, measured against the root's width so the scrollbar gutter never counts. */
export function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      Math.ceil(document.documentElement.getBoundingClientRect().width),
  );
}

/** How many panels reach into the page's side margin or have square corners. On a phone each panel is a card that
 * never touches the screen's edge. */
export function panelsOffMargin(page: Page, margin = 16): Promise<number> {
  return page.evaluate((gutter) => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll("main .fw-panel")].filter((panel) => {
      const box = panel.getBoundingClientRect();
      return (
        box.width > 0 &&
        (box.left < gutter - 0.5 ||
          box.right > width - gutter + 0.5 ||
          getComputedStyle(panel).borderTopLeftRadius === "0px")
      );
    }).length;
  }, margin);
}
