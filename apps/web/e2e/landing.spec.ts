import { expect, test } from "@playwright/test";
import { textContrast } from "./contrast";

const ORDER = [
  "nav",
  "hero",
  "networks",
  "how",
  "profiles",
  "checkout",
  "rules",
  "developers",
  "fees",
  "faq",
  "cta",
  "footer",
];

test.describe("landing page", () => {
  test("shows every section in order", async ({ page }) => {
    await page.goto("/");
    const order = await page.$$eval("[data-section]", (els) =>
      els.map((el) => el.getAttribute("data-section")),
    );
    expect(order).toEqual(ORDER);
    for (const section of ORDER) {
      await expect(page.locator(`[data-section="${section}"]`)).toBeVisible();
    }

    await expect(
      page.locator('[data-section="nav"]').getByRole("link", { name: "Join waitlist" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const networks = page.getByRole("region", { name: "Planned networks and stablecoins" });
    for (const name of ["Base", "Arbitrum", "Arc", "Tempo", "USDC", "USDT"]) {
      await expect(networks.getByText(name, { exact: true })).toBeVisible();
    }

    await expect(page.getByTestId("developer-code")).toContainText("invoices.create");
    await expect(page.locator("body")).not.toContainText(/trusted by/i);
  });

  test("profile tabs switch panels", async ({ page }) => {
    await page.goto("/");
    const panels = {
      Personal: "Your everyday stablecoin account",
      Freelancer: "Invoices your clients can actually pay",
      Merchant: "Checkout for every store you run",
      Developers: "Payments your backend can trust",
    };
    for (const [tab, heading] of Object.entries(panels)) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(
        page.getByRole("tabpanel").getByRole("heading", { name: heading }),
      ).toBeVisible();
    }
  });

  test("an FAQ item expands on click", async ({ page }) => {
    await page.goto("/");
    const item = page.locator("details", { hasText: "Who holds my money?" });
    await expect(item).not.toHaveAttribute("open", "");
    await item.locator("summary").click();
    await expect(item).toHaveAttribute("open", "");
    await expect(item.getByText(/settles to a wallet that belongs to your profile/)).toBeVisible();
  });

  // 330 also covers the ~345px layout width Linux CI gets at 360 (classic 15px scrollbar).
  for (const width of [330, 360, 768, 1280, 1536]) {
    test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const { scroll, viewport, culprits } = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        // Elements that stick out past the viewport and are not inside a scrolling or clipping box.
        const culprits = [...document.querySelectorAll("body *")]
          .filter((el) => el.getBoundingClientRect().right > vw + 0.5)
          .filter((el) => {
            for (let a = el.parentElement; a; a = a.parentElement) {
              if (["hidden", "auto", "clip", "scroll"].includes(getComputedStyle(a).overflowX))
                return false;
            }
            return true;
          })
          .slice(0, 5)
          .map(
            (el) =>
              `<${el.tagName.toLowerCase()} class="${String(el.getAttribute("class")).slice(0, 80)}"> right=${Math.round(el.getBoundingClientRect().right)} text="${el.textContent?.trim().slice(0, 40)}"`,
          );
        return {
          scroll: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
          culprits,
        };
      });
      expect(scroll, `wider than the viewport:\n${culprits.join("\n")}`).toBeLessThanOrEqual(
        viewport,
      );
    });
  }

  for (const width of [360, 768, 1280, 1536]) {
    test(`keeps every amount inside its card at ${width}px, on every profile tab`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      for (const tab of ["Personal", "Freelancer", "Merchant", "Developers"]) {
        await page.getByRole("tab", { name: tab }).click();
        const overflows = await page.$$eval("[data-money]", (els) =>
          els
            .filter((el) => (el as HTMLElement).offsetParent !== null)
            .flatMap((el) => {
              let card = el.parentElement;
              while (card && Number.parseFloat(getComputedStyle(card).borderLeftWidth) === 0) {
                card = card.parentElement;
              }
              if (!card) return [];
              const a = el.getBoundingClientRect();
              const b = card.getBoundingClientRect();
              return a.right > b.right + 0.5 || a.left < b.left - 0.5
                ? [`${el.textContent?.trim()} (${Math.round(a.right)} > ${Math.round(b.right)})`]
                : [];
            }),
        );
        expect(overflows, `${tab} tab`).toEqual([]);
      }
    });
  }

  test("respects reduced motion", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/");
    const longest = await page.evaluate(() => {
      const seconds = (value: string) =>
        Math.max(
          ...value
            .split(",")
            .map((v) =>
              v.trim().endsWith("ms") ? Number.parseFloat(v) / 1000 : Number.parseFloat(v),
            ),
        );
      let max = 0;
      for (const el of document.querySelectorAll("*")) {
        const style = getComputedStyle(el);
        const running = style.animationName !== "none" ? seconds(style.animationDuration) : 0;
        max = Math.max(max, running, seconds(style.transitionDuration));
      }
      return max;
    });
    expect(longest).toBeLessThanOrEqual(0.01);
    await context.close();
  });

  test("uses the generated hero and checkout images", async ({ page }) => {
    await page.goto("/");
    const src = (section: string) =>
      page.locator(`[data-section="${section}"] img`).first().getAttribute("src");
    expect(await src("hero")).toMatch(/\/_next\/image\?url=%2Fimages%2Fhero-dawn\.webp/);
    expect(await src("checkout")).toMatch(/\/_next\/image\?url=%2Fimages%2Fcheckout-dusk\.webp/);
    const hero = page.locator('[data-section="hero"] img').first();
    await expect(hero).toHaveJSProperty("complete", true);
    expect(await hero.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  });

  test("serves every image through next/image", async ({ page }) => {
    await page.goto("/");
    for (const src of await page
      .locator("img")
      .evaluateAll((imgs) => imgs.map((i) => i.getAttribute("src") ?? ""))) {
      expect(src).toContain("/_next/image");
    }
  });
});

const overlaps = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

for (const width of [360, 390]) {
  test(`at ${width}px all four river marks are in open water`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const result = await page.evaluate(() => {
      const hero = document.querySelector('[data-section="hero"]') as HTMLElement;
      const rect = (el: Element | null) => (el as HTMLElement).getBoundingClientRect();
      const marks = [...hero.querySelectorAll("circle[data-river-mark]")]
        .filter((c) => (c as SVGElement).getBoundingClientRect().width > 0)
        .map((c) => (c as SVGElement).getBoundingClientRect());
      const blockers = {
        form: rect(hero.querySelector("form")),
        note: rect(
          [...hero.querySelectorAll("p")].find((p) => p.textContent?.startsWith("Private beta")) ??
            null,
        ),
        panel: rect(
          hero.querySelector('[aria-label="Sample payment progress"]')?.closest(".rounded-lg") ??
            null,
        ),
      };
      return {
        marks: marks.map((m) => m.toJSON()),
        blockers: Object.fromEntries(Object.entries(blockers).map(([k, v]) => [k, v.toJSON()])),
      };
    });
    expect(result.marks).toHaveLength(4);
    for (const [i, mark] of result.marks.entries()) {
      for (const [name, box] of Object.entries(result.blockers)) {
        expect(overlaps(mark as DOMRect, box as DOMRect), `mark ${i} overlaps the ${name}`).toBe(
          false,
        );
      }
    }
  });
}

test.describe("hero frame and legibility", () => {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    test(`is full-bleed with no rounded corners at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const box = await page.evaluate(() => {
        const hero = document.querySelector('[data-section="hero"]') as HTMLElement;
        const art = hero.querySelector("img")?.parentElement as HTMLElement;
        const r = hero.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          height: r.height,
          viewport: document.documentElement.clientWidth,
          radius: [getComputedStyle(hero).borderRadius, getComputedStyle(art).borderRadius],
        };
      });
      expect(box.left).toBe(0);
      expect(box.right).toBe(box.viewport);
      expect(box.radius).toEqual(["0px", "0px"]);
      if (width >= 1024) expect(box.height).toBeGreaterThanOrEqual(height);
    });
  }

  for (const width of [1440, 390]) {
    test(`subhead and beta note read at >= 4.5:1 at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      const hero = page.locator('[data-section="hero"]');
      for (const text of [hero.locator("h1 + p"), hero.getByText(/^Private beta/)]) {
        expect(await textContrast(page, text)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
