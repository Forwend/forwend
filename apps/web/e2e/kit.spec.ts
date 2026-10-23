import { expect, test } from "@playwright/test";
import { KIT_URL, PUBLIC_URL } from "./servers";

// The kit is internal: it must never be reachable or indexed on the public site.
test.describe("kit privacy", () => {
  for (const path of ["/kit", "/kit/directions"]) {
    test(`${path} returns 404 when KIT_ENABLED is not set`, async ({ request }) => {
      expect((await request.get(`${PUBLIC_URL}${path}`)).status()).toBe(404);
    });

    test(`${path} is not indexed when the kit is on`, async ({ page }) => {
      await page.goto(`${KIT_URL}${path}`);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    });
  }
});

test("a tap opens a tooltip on a touch screen, and a tap elsewhere closes it", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(`${KIT_URL}/kit`);
  const tip = page.getByRole("tooltip").filter({ hasText: "An estimate in USD" });
  const trigger = page.getByRole("button", { name: "An estimate in USD" });
  await trigger.tap();
  await expect(tip).toBeVisible();
  await page.getByRole("heading", { level: 1 }).first().tap();
  await expect(tip).toBeHidden();
  await trigger.tap();
  await expect(tip).toBeVisible();
  await trigger.tap();
  await expect(tip).toBeHidden();

  // A swipe that starts on the trigger is a scroll, not a tap: afterwards a tap elsewhere still closes the tooltip.
  await trigger.tap();
  await expect(tip).toBeVisible();
  const box = await trigger.boundingBox();
  const cdp = await context.newCDPSession(page);
  const at = (y: number) => [{ x: (box?.x ?? 0) + 8, y: (box?.y ?? 0) + y }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(8) });
  for (let y = 8; y > -200; y -= 40) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(y) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.getByRole("heading", { level: 1 }).first().tap();
  await expect(tip).toBeHidden();
  await context.close();
});
