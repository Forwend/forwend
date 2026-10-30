import { expect, type Page, test } from "@playwright/test";
import { blockingViolations } from "./privy/axe";
import { sampleInvoice } from "./privy/sample-api";
import { sidewaysScroll } from "./sideways";

// R-142: the API answers are mocked; the Go API test covers the real ones.
const SLUG = "k3f9q2m7x1ab";
const FIXED = {
  version: "1",
  livemode: false,
  slug: SLUG,
  title: "Logo design",
  payee: "Alice Shop Ltd",
  brand: { storeId: "66666666-6666-4666-8666-666666666666", color: "#1f6a8c", logoAt: null },
  amountUsd: "50.00",
  minUsd: null,
  maxUsd: null,
  state: "on",
};
const OPEN_LINK = { ...FIXED, title: "Top up", amountUsd: null, minUsd: "10.00", maxUsd: "500.00" };
// The checkout's read: the list sample plus its deposits.
const INVOICE = { ...sampleInvoice(2, "open", "none", "Logo design", null), deposits: [] };

/** The link, its visits and its Pay; Pay answers each refusal in turn, then 201. */
async function mockLink(
  page: Page,
  first: object,
  ...refusals: { status: number; code: string }[]
) {
  const calls = { visits: 0, pays: [] as { key: string | undefined; body: unknown }[] };
  let link = first;
  await page.route(`**/api/v1/links/${SLUG}`, (route) => route.fulfill({ json: link }));
  await page.route(`**/api/v1/links/${SLUG}/visits`, (route) => {
    calls.visits++;
    return route.fulfill({ status: 204 });
  });
  await page.route(`**/api/v1/links/${SLUG}/pay`, (route) => {
    const request = route.request();
    calls.pays.push({ key: request.headers()["idempotency-key"], body: request.postDataJSON() });
    const refusal = refusals.shift();
    return route.fulfill(
      refusal
        ? { status: refusal.status, json: { error: { code: refusal.code, message: refusal.code } } }
        : { status: 201, json: { payToken: INVOICE.payToken } },
    );
  });
  // The pay page the new invoice opens; null answers 500.
  await page.route("**/api/v1/invoices/*", (route) =>
    route.request().method() !== "GET"
      ? route.fulfill({ status: 204 })
      : route.fulfill({ json: INVOICE }),
  );
  return {
    calls,
    setLink: (next: object) => {
      link = next;
    },
  };
}

const payButton = (page: Page) => page.getByRole("button", { name: "Pay", exact: true });

test.describe("payment link page", () => {
  test("a purchase resumes after Back and reload, while another purchase uses a fresh identity", async ({
    page,
  }) => {
    const { calls } = await mockLink(page, FIXED);
    await page.goto(`/l/${SLUG}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alice Shop Ltd");
    await expect(page.getByText("Logo design", { exact: true })).toBeVisible();
    await expect(page.getByText("Testnet", { exact: true })).toBeVisible();
    await expect(page.locator("[data-money]")).toHaveText("50.00 USD");
    await expect.poll(() => calls.visits).toBe(1);
    await payButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/pay/${INVOICE.payToken}$`));
    const first = calls.pays[0];
    expect(first).toEqual({
      key: expect.stringMatching(/:5000$/),
      body: { expectedAmountUsd: "50.00", expectedVersion: "1" },
    });
    await page.goBack();
    await expect(page.getByRole("button", { name: "Continue payment", exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Continue payment", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/pay/${INVOICE.payToken}$`));
    expect(calls.pays).toEqual([first, first]);
    await page.goBack();
    await page.getByRole("button", { name: "Start another purchase", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Amount", exact: true })).toBeFocused();
    await payButton(page).click();
    await expect.poll(() => calls.pays.length).toBe(3);
    expect(calls.pays[2]?.key).not.toBe(first?.key);
  });

  test("Pay keeps the link page still and the checkout opens whole, with no empty page between", async ({
    page,
  }) => {
    await mockLink(page, FIXED);
    // Pay and the checkout's invoice answer late, so the pages are seen while they wait.
    for (const path of [`**/api/v1/links/${SLUG}/pay`, "**/api/v1/invoices/*"]) {
      await page.route(path, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        await route.fallback();
      });
    }
    await page.goto(`/l/${SLUG}`);
    await expect(page.locator("[data-money]")).toHaveText("50.00 USD");
    await page.evaluate(() => {
      const w = window as unknown as {
        samples: { path: string; previous: boolean; whole: boolean }[];
      };
      w.samples = [];
      const sample = () => {
        w.samples.push({
          path: location.pathname,
          previous: Boolean(document.body.textContent?.includes("Your previous payment")),
          // The checkout's own content: its amount, or the warning this sample invoice gets.
          whole: Boolean(document.querySelector("#pay-amount, main [role=alert]")),
        });
        requestAnimationFrame(sample);
      };
      sample();
    });
    await payButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/pay/${INVOICE.payToken}$`));
    // The sample invoice's terms don't derive its address, so the checkout opens on its mismatch warning.
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    const frames = await page.evaluate(
      () =>
        (window as unknown as { samples: { path: string; previous: boolean; whole: boolean }[] })
          .samples,
    );
    expect(frames.filter((f) => f.previous)).toEqual([]);
    expect(frames.filter((f) => f.path.startsWith("/pay/") && !f.whole)).toEqual([]);
  });

  test("an uncertain response survives reload when browser storage is unavailable", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      for (const name of ["localStorage", "sessionStorage"]) {
        Object.defineProperty(window, name, {
          get: () => {
            throw new Error("storage unavailable");
          },
        });
      }
    });
    const { calls } = await mockLink(page, FIXED, { status: 500, code: "internal" });
    await page.goto(`/l/${SLUG}`);
    await payButton(page).click();
    await expect(
      page.getByText("We could not check whether checkout started. Continue payment to try again."),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Your previous payment", exact: true }),
    ).toBeFocused();
    const first = calls.pays[0];
    await page.reload();
    await page.getByRole("button", { name: "Continue payment", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/pay/${INVOICE.payToken}$`));
    expect(calls.pays).toEqual([first, first]);
  });

  test("recovery retains the quoted price and offer revision after the seller changes them", async ({
    page,
  }) => {
    const { calls, setLink } = await mockLink(
      page,
      FIXED,
      { status: 500, code: "internal" },
      { status: 409, code: "link_changed" },
    );
    await page.goto(`/l/${SLUG}`);
    await payButton(page).click();
    await expect(
      page.getByText("We could not check whether checkout started. Continue payment to try again."),
    ).toBeVisible();
    setLink({ ...FIXED, amountUsd: "100.00", version: "2" });
    await page.reload();
    await expect(page.locator("[data-money]")).toHaveText("50.00 USD");
    await page.getByRole("button", { name: "Continue payment", exact: true }).click();
    await expect(
      page.getByText("This offer changed. Start another purchase to review the current price."),
    ).toBeVisible();
    expect(calls.pays[1]).toEqual(calls.pays[0]);
    expect(calls.pays[1]?.body).toEqual({ expectedAmountUsd: "50.00", expectedVersion: "1" });
    await page.getByRole("button", { name: "Start another purchase", exact: true }).click();
    await expect(page.locator("[data-money]")).toHaveText("100.00 USD");
  });

  test("independent customers receive independent purchase identities", async ({ browser }) => {
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const mocks = await Promise.all(pages.map((page) => mockLink(page, FIXED)));
      await Promise.all(pages.map((page) => page.goto(`/l/${SLUG}`)));
      await Promise.all(pages.map((page) => payButton(page).click()));
      await Promise.all(
        pages.map((page) => expect(page).toHaveURL(new RegExp(`/pay/${INVOICE.payToken}$`))),
      );
      const keys = mocks.map((mock) => mock.calls.pays[0]?.key);
      expect(keys[0]).toBeTruthy();
      expect(keys[1]).toBeTruthy();
      expect(keys[0]).not.toBe(keys[1]);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test("an open link takes the payer's amount within its limits", async ({ page }) => {
    const { calls } = await mockLink(page, OPEN_LINK, { status: 429, code: "rate_limited" });
    await page.goto(`/l/${SLUG}`);
    const amount = page.getByRole("textbox", { name: "Amount (USD)" });
    await expect(amount).toHaveAccessibleDescription(
      "10.00–500.00 USD. You pay in a stablecoin worth 1 USD each.",
    );
    for (const [typed, message] of [
      ["", "Enter an amount like 25 or 25.50."],
      ["abc", "Enter an amount like 25 or 25.50."],
      ["5", "Enter an amount within the limits: 10.00–500.00 USD."],
      ["501", "Enter an amount within the limits: 10.00–500.00 USD."],
    ] as const) {
      await amount.fill(typed);
      await payButton(page).click();
      await expect(page.getByText(message)).toBeVisible();
      await expect(amount).toBeFocused();
    }
    expect(calls.pays).toEqual([]);

    await amount.fill("25");
    await payButton(page).click();
    await expect(
      page.getByText("Many payments are starting right now. Try again in a minute."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue payment", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/pay/${INVOICE.payToken}$`));
    // A retry of the same amount sends the same key, so the API makes one invoice.
    expect(calls.pays).toEqual([
      {
        key: expect.stringMatching(/:2500$/),
        body: { amountUsd: "25", expectedAmountUsd: "25.00", expectedVersion: "1" },
      },
      {
        key: calls.pays[0]?.key,
        body: { amountUsd: "25", expectedAmountUsd: "25.00", expectedVersion: "1" },
      },
    ]);
  });

  test("a link that is off, ended or full says why and offers no Pay", async ({ page }) => {
    for (const [state, message] of [
      ["off", "This link is off. Ask the seller for another way to pay."],
      ["ended", "This link has ended. Ask the seller for another way to pay."],
      ["full", "This link has no available payment slots right now."],
      ["not_ready", "This seller can't take payments yet. Ask them for another way to pay."],
    ] as const) {
      await page.unrouteAll();
      const { calls } = await mockLink(page, { ...FIXED, state });
      await page.goto(`/l/${SLUG}`);
      await expect(page.getByRole("status").filter({ hasText: message })).toBeVisible();
      await expect(payButton(page)).toHaveCount(0);
      expect(calls.pays).toEqual([]);
    }
  });

  test("a Pay refused because the link closed shows why and moves focus there", async ({
    page,
  }) => {
    const { setLink } = await mockLink(page, FIXED, { status: 409, code: "link_off" });
    await page.goto(`/l/${SLUG}`);
    await expect(payButton(page)).toBeVisible();
    setLink({ ...FIXED, state: "off" });
    await payButton(page).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "This link is off. Ask the seller for another way to pay." }),
    ).toBeFocused();
  });

  test("says when the seller can't take payments yet", async ({ page }) => {
    await mockLink(page, FIXED, { status: 409, code: "billing_details_required" });
    await page.goto(`/l/${SLUG}`);
    await payButton(page).click();
    await expect(
      page.getByText("This seller can't take payments yet. Ask them for another way to pay."),
    ).toBeVisible();
  });

  test("answers 404 for a malformed address and shows the 404 page for an unknown one", async ({
    page,
  }) => {
    expect((await page.goto("/l/Not-A-Link"))?.status()).toBe(404);
    await page.route("**/api/v1/links/*", (route) =>
      route.fulfill({
        status: 404,
        json: { error: { code: "link_not_found", message: "payment link not found" } },
      }),
    );
    await page.goto(`/l/${SLUG}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This path ends here.");
  });

  test("fits a 390 px phone without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockLink(page, { ...OPEN_LINK, title: `Top up ${"x".repeat(200)}` });
    await page.goto(`/l/${SLUG}`);
    await expect(page.getByRole("textbox", { name: "Amount (USD)" })).toBeVisible();
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`has no serious or critical axe violations in the ${colorScheme} theme`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ colorScheme });
      const page = await context.newPage();
      await mockLink(page, OPEN_LINK);
      await page.goto(`/l/${SLUG}`);
      await expect(page.getByRole("textbox", { name: "Amount (USD)" })).toBeVisible();
      expect(await blockingViolations(page)).toEqual([]);
      await payButton(page).click();
      await expect(page.getByText("Enter an amount like 25 or 25.50.")).toBeVisible();
      expect(await blockingViolations(page)).toEqual([]);
      await context.close();
    });
  }
});
