import { expect, test } from "@playwright/test";
import { KIT_URL, PUBLIC_URL } from "./servers";

// Headless Chromium hides scrollbars by default, which would hide any change in their room. Without smooth
// scrolling a key that scrolls the page moves it before the next read.
test.use({
  launchOptions: {
    ignoreDefaultArgs: ["--hide-scrollbars"],
    args: ["--disable-smooth-scrolling"],
  },
});

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

test("opening a select keeps the scrollbar and the page in place", async ({ page }) => {
  await page.goto(`${KIT_URL}/kit`);
  const select = page.getByRole("combobox", { name: "Network" });
  await select.scrollIntoViewIfNeeded();
  const frame = () =>
    page.evaluate(() => ({
      scrollbar: window.innerWidth - document.documentElement.clientWidth,
      left: document.querySelector("main")?.getBoundingClientRect().left,
      top: window.scrollY,
    }));
  const before = await frame();
  expect(before.scrollbar).toBeGreaterThan(0);
  await select.click();
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  await page.mouse.wheel(0, 400);
  // Off the options the list itself has focus, and Space would scroll the page.
  await list.getByRole("option").first().hover();
  await page.mouse.move(1, 1);
  for (const key of ["Space", "PageDown", "End"]) await page.keyboard.press(key);
  await expect(list).toBeVisible();
  expect(await frame()).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  expect(await frame()).toEqual(before);
});

test("a long list's panel opens where it has room and stays in the window", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${KIT_URL}/kit`);
  const field = page.getByRole("button", { name: /^Country\b/ }).first();
  const list = page.getByRole("listbox", { name: "Country" });
  // The field's foot `gap` px above the window's bottom, then its top `gap` px below the window's top.
  for (const [gap, side] of [
    [120, "top"],
    [120, "bottom"],
  ] as const) {
    await field.evaluate(
      (el, { gap, side }) => {
        const box = el.getBoundingClientRect();
        window.scrollBy(
          0,
          side === "top" ? box.bottom - (window.innerHeight - gap) : box.top - gap,
        );
      },
      { gap, side },
    );
    await field.click();
    await expect(list).toBeVisible();
    const panel = list.locator("..");
    await expect(panel).toHaveAttribute("data-side", side);
    const box = await panel.boundingBox();
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect(box && box.y + box.height).toBeLessThanOrEqual(720);
    // At least three and a half rows stay in view.
    expect((await list.boundingBox())?.height).toBeGreaterThanOrEqual(120);
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
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

test("a dialog and a centered sheet fade in as they open, and at once with reduced motion", async ({
  browser,
}) => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    const context = await browser.newContext({
      reducedMotion,
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await page.goto(`${KIT_URL}/kit`);
    for (const [trigger, name] of [
      ["Open dialog", "Confirm withdrawal"],
      ["Open sheet", "Receive"],
    ]) {
      await page.getByRole("button", { name: trigger, exact: true }).click();
      const dialog = page.getByRole("dialog", { name });
      const seen = await dialog.evaluate(
        (el) =>
          new Promise<number[][]>((resolve) => {
            const frames: number[][] = [];
            const sample = () => {
              frames.push([
                Number(getComputedStyle(el).opacity),
                Number(getComputedStyle(el, "::backdrop").opacity),
              ]);
              if (frames.length < 4) requestAnimationFrame(sample);
              else resolve(frames);
            };
            sample();
          }),
      );
      // Reduced motion: both whole a few frames in, while a 200 ms fade is still under way.
      if (reducedMotion === "reduce") expect(seen.at(-1)).toEqual([1, 1]);
      else expect(Math.min(...seen.flat())).toBeLessThan(1);
      await expect
        .poll(() => dialog.evaluate((el) => Number(getComputedStyle(el).opacity)))
        .toBe(1);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
    await context.close();
  }
});

test("a placeholder's pulse runs on the compositor, so a busy page doesn't stall it", async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  const events: {
    name: string;
    id2?: { local?: string };
    args?: { data?: Record<string, unknown> };
  }[] = [];
  cdp.on("Tracing.dataCollected", (d) => events.push(...(d.value as unknown as typeof events)));
  const done = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Tracing.start", { categories: "blink.animations", transferMode: "ReportEvents" });
  await page.goto(`${KIT_URL}/kit`);
  await expect(page.locator("[data-skeleton]").first()).toBeAttached();
  await page.waitForTimeout(1000);
  await cdp.send("Tracing.end");
  await done;
  // Chromium's reason "the target has incompatible animations": two animations of one property.
  const INCOMPATIBLE = 64;
  const byAnimation = new Map<string, { name?: unknown; failed?: unknown }>();
  for (const e of events.filter((x) => x.name === "Animation")) {
    const seen = byAnimation.get(e.id2?.local ?? "") ?? {};
    seen.name ??= e.args?.data?.displayName;
    seen.failed ??= e.args?.data?.compositeFailed;
    byAnimation.set(e.id2?.local ?? "", seen);
  }
  const placeholders = [...byAnimation.values()].filter((a) => a.name === "fw-pulse");
  expect(placeholders.length).toBeGreaterThan(0);
  expect(placeholders.filter((a) => (Number(a.failed ?? 0) & INCOMPATIBLE) !== 0)).toEqual([]);
});
