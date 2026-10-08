import { expect, test } from "@playwright/test";

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

  for (const width of [360, 768, 1280, 1536]) {
    test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const { scroll, viewport } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(scroll).toBeLessThanOrEqual(viewport);
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

  test("serves every image through next/image", async ({ page }) => {
    await page.goto("/");
    for (const src of await page
      .locator("img")
      .evaluateAll((imgs) => imgs.map((i) => i.getAttribute("src") ?? ""))) {
      expect(src).toContain("/_next/image");
    }
  });
});
