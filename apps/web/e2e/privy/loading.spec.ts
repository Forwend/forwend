import { expect, test } from "@playwright/test";
import { mockApi } from "./sample-api";
import { session } from "./session";

test("switching to a list page shows its placeholder at once and keeps its rows in place while it loads", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  await page.route(/\/api\/v1\/profiles\/[^/]+\/invoices\?/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fallback();
  });
  await page.goto("/app/payments");
  const main = page.getByRole("main");
  const sidebar = page.locator("aside");
  await expect(main.getByRole("heading", { level: 1 })).toBeAttached();
  await page.evaluate(() => {
    const w = window as unknown as { shift: number };
    w.shift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        w.shift += (entry as unknown as { value: number }).value;
    }).observe({ type: "layout-shift" });
  });
  const placeholder = main.locator("[data-skeleton]").first();
  const opacity = () => placeholder.evaluate((el) => Number(getComputedStyle(el).opacity));
  const firstRow = () => main.locator("tbody tr").first().boundingBox();

  await sidebar.getByRole("link", { name: "Invoices", exact: true }).click();
  await expect(placeholder).toBeAttached();
  // No wait before it: the pulse dims it to half at most.
  expect(await opacity()).toBeGreaterThan(0.4);
  const loading = await firstRow();
  await expect(main.getByRole("row").filter({ hasText: "INV-" }).first()).toBeVisible();
  const loaded = await firstRow();
  // Within a pixel: the collapsed table border can split half a pixel either way.
  expect(Math.abs((loaded?.y ?? 0) - (loading?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(loaded?.height).toBe(loading?.height);
  expect(await page.evaluate(() => (window as unknown as { shift: number }).shift)).toBeLessThan(
    0.01,
  );

  await context.close();

  // A phone with reduced motion: the money list's two-line rows (amount over status) keep their place, and the
  // placeholder holds still.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    storageState: session,
  });
  const small = await phone.newPage();
  await mockApi(small);
  await small.route(/\/api\/v1\/profiles\/[^/]+\/invoices\?/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fallback();
  });
  await small.goto("/app/invoices");
  const phoneMain = small.getByRole("main");
  const placeholderRow = phoneMain.locator("[aria-hidden] li").first();
  await expect(placeholderRow).toBeVisible();
  await expect
    .poll(() =>
      placeholderRow
        .locator("[data-skeleton]")
        .first()
        .evaluate((el) => Number(getComputedStyle(el).opacity)),
    )
    .toBe(1);
  const waiting = await placeholderRow.boundingBox();
  const row = phoneMain.getByRole("listitem").filter({ hasText: "INV-" }).first();
  await expect(row).toBeVisible();
  const arrived = await row.boundingBox();
  // Within a pixel: the amount's line mixes two type sizes, which can add one to its line box.
  expect(Math.abs((arrived?.y ?? 0) - (waiting?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((arrived?.height ?? 0) - (waiting?.height ?? 0))).toBeLessThanOrEqual(1);

  await phone.close();
});

test("the overview's balance and pending cards keep their size while they load, and a total never says prices are missing on the way", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  const late = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const fresh = new Date().toISOString();
  // Prices and the pending payments answer after the balances, as they often do.
  await page.route("**/api/v1/prices", async (route) => {
    await late(1200);
    await route.fulfill({
      json: {
        prices: [
          {
            chainId: 84532,
            token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
            symbol: "USDC",
            coinId: "usd-coin",
            usd: "1",
            sourceUpdatedAt: fresh,
            fetchedAt: fresh,
            stale: false,
          },
        ],
      },
    });
  });
  await page.route(/\/api\/v1\/profiles\/[^/]+\/payments\?/, async (route) => {
    await late(1200);
    await route.fallback();
  });
  await page.addInitScript(() => {
    const w = window as unknown as { missing: boolean; heights: Record<string, number[]> };
    w.missing = false;
    w.heights = {};
    const sample = () => {
      if (document.querySelector("main")?.textContent?.includes("Market prices are unavailable"))
        w.missing = true;
      for (const id of ["balance-title", "on-its-way"]) {
        const card = document.getElementById(id)?.closest("section");
        if (card) {
          const height = Math.round(card.getBoundingClientRect().height);
          w.heights[id] ??= [];
          if (w.heights[id].at(-1) !== height) w.heights[id].push(height);
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto("/app");
  await expect(page.getByRole("main").getByText("18,420", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("main").locator("[data-skeleton]")).toHaveCount(0);
  const seen = await page.evaluate(() => {
    const w = window as unknown as { missing: boolean; heights: Record<string, number[]> };
    return { missing: w.missing, heights: w.heights };
  });
  expect(seen.missing).toBe(false);
  // Each card has one height from its first frame to its loaded one.
  expect(seen.heights["balance-title"]).toHaveLength(1);
  expect(seen.heights["on-its-way"]).toHaveLength(1);
  await context.close();
});

test("the overview's Received and My assets cards keep their size while they load", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  const late = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  // The transfer count and the balances answer after the history, as they can.
  await page.route(/\/api\/v1\/profiles\/[^/]+\/(transactions|balances)(\?|$)/, async (route) => {
    await late(1200);
    await route.fallback();
  });
  await page.addInitScript(() => {
    const w = window as unknown as { seen: Record<string, number[]> };
    w.seen = {};
    const note = (key: string, value: number | undefined) => {
      if (value === undefined) return;
      w.seen[key] ??= [];
      if (w.seen[key].at(-1) !== Math.round(value)) w.seen[key].push(Math.round(value));
    };
    const sample = () => {
      const received = document.getElementById("received-title")?.closest("section");
      const range = received?.querySelector("fieldset");
      if (received && range)
        note("range", range.getBoundingClientRect().top - received.getBoundingClientRect().top);
      note(
        "assets",
        document.getElementById("assets-title")?.closest("section")?.getBoundingClientRect().height,
      );
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto("/app");
  const main = page.getByRole("main");
  await expect(main.getByText(/transfers in/)).toBeVisible();
  await expect(
    main.locator("section", { has: page.locator("#assets-title") }).getByText("USDC"),
  ).toBeVisible();
  await expect(main.locator("[data-skeleton]")).toHaveCount(0);
  const seen = await page.evaluate(
    () => (window as unknown as { seen: Record<string, number[]> }).seen,
  );
  // One place for the range control and one height for My assets, from the first frame to the loaded one.
  expect(seen).toEqual({ range: [expect.any(Number)], assets: [expect.any(Number)] });
  await context.close();
});

test("the sidebar's mark moves with the page, with no fade left behind", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  await page.goto("/app/invoices");
  const sidebar = page.locator("aside");
  const invoices = sidebar.getByRole("link", { name: "Invoices", exact: true });
  await expect(invoices).toHaveAttribute("aria-current", "page");
  const rest = await sidebar
    .getByRole("link", { name: "Clients", exact: true })
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.evaluate(() => {
    const w = window as unknown as { frames: { path: string; mark: string }[] };
    w.frames = [];
    const row = document.querySelector<HTMLElement>('aside a[href="/app/invoices"]');
    const sample = () => {
      w.frames.push({
        path: location.pathname,
        mark: row ? getComputedStyle(row).backgroundColor : "",
      });
      requestAnimationFrame(sample);
    };
    sample();
  });
  await sidebar.getByRole("link", { name: "Payments", exact: true }).click();
  await expect(sidebar.getByRole("link", { name: "Payments", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.waitForTimeout(300);
  const frames = await page.evaluate(
    () => (window as unknown as { frames: { path: string; mark: string }[] }).frames,
  );
  // Once the page is Payments, Invoices is never still half marked.
  expect(frames.filter((f) => f.path === "/app/payments" && f.mark !== rest)).toEqual([]);
  await context.close();
});

test("a record page keeps its panels in place while it loads", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  await page.route(/\/api\/v1\/profiles\/[^/]+\/stores\/[^/]+$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fallback();
  });
  await page.goto("/app/stores/66666666-6666-4666-8666-666666666666");
  const main = page.getByRole("main");
  // The first panel under the header, the same element while the store loads and after.
  const panels = page.locator("#app-content > div > :nth-child(2)");
  await expect(main.locator("[data-skeleton]").first()).toBeAttached();
  const loading = await panels.boundingBox();
  await expect(main.getByRole("heading", { level: 1, name: "Sample shop" })).toBeVisible();
  const loaded = await panels.boundingBox();
  expect(Math.abs((loaded?.y ?? 0) - (loading?.y ?? 0))).toBeLessThanOrEqual(1);
  await context.close();
});

test("when the server can't be reached, one strip under the header says so, in place of each part's notice", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  let down = true;
  let failPayments = false;
  // The web server's own answer when its proxy can't reach the api: plain text, not the api's JSON.
  const unreachable = { status: 500, contentType: "text/plain", body: "Internal Server Error" };
  await page.route(/\/api\/v1\/profiles\/[^/]+\/stores$/, (route) =>
    down ? route.fulfill(unreachable) : route.fallback(),
  );
  await page.route(/\/api\/v1\/profiles\/[^/]+\/payments\?/, (route) =>
    down && failPayments ? route.fulfill(unreachable) : route.fallback(),
  );
  await page.goto("/app/payments");
  const strip = page.getByRole("alert").filter({ hasText: "Can't reach the server. Retrying…" });
  await expect(strip).toHaveCount(1);
  await expect(page.getByText(/We could not load stores/)).toHaveCount(0);
  // The list's refresh fails too: still the one strip, and no notice over the list.
  failPayments = true;
  const refetch = page.waitForResponse((r) => r.url().includes("/payments?") && r.status() === 500);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refetch;
  await expect(page.getByText(/We could not refresh payments/)).toHaveCount(0);
  await expect(strip).toHaveCount(1);
  const header = await page.locator("header.sticky").boundingBox();
  const line = await strip.boundingBox();
  expect(Math.abs((line?.y ?? 0) - ((header?.y ?? 0) + (header?.height ?? 0)))).toBeLessThanOrEqual(
    1,
  );
  // Back: the strip retries every read, also the stores, which don't poll, and goes.
  down = false;
  await expect(strip).toHaveCount(0, { timeout: 20_000 });
  await context.close();
});
