import { expect, type Page, test } from "@playwright/test";
import { blockingViolations } from "./privy/axe";
import { sampleInvoice } from "./privy/sample-api";
import { sidewaysScroll } from "./sideways";

// R-142: the API answers are mocked; the Go API test covers the real ones.
const SLUG = "k3f9q2m7x1ab";
const FIXED = {
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
  let invoice: object | null = INVOICE;
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
      : invoice
        ? route.fulfill({ json: invoice })
        : route.fulfill({
            status: 500,
            json: { error: { code: "internal", message: "internal" } },
          }),
  );
  return {
    calls,
    setLink: (next: object) => {
      link = next;
    },
    setInvoice: (next: object | null) => {
      invoice = next;
    },
  };
}

const payButton = (page: Page) => page.getByRole("button", { name: "Pay", exact: true });

test.describe("payment link page", () => {
  test("shows who asks and the amount, counts one visit, and Pay opens the payer's invoice, reused while open", async ({
    page,
  }) => {
    const { calls, setInvoice } = await mockLink(page, FIXED);
    await page.goto(`/l/${SLUG}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alice Shop Ltd");
    await expect(page.getByText("Logo design", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Test mode:.*testnet tokens/)).toBeVisible();
    await expect(page.locator("[data-money]")).toHaveText("50.00 USD");
    await expect(page.getByText("You pick the token and network on the next page.")).toBeVisible();
    await expect.poll(() => calls.visits).toBe(1);

    await payButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/pay/${INVOICE.payToken}$`));
    expect(calls.pays).toEqual([{ key: expect.stringMatching(/:5000$/), body: {} }]);

    // The same browser goes back to its open invoice for the same amount.
    await page.goto(`/l/${SLUG}`);
    await payButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/pay/${INVOICE.payToken}$`));
    expect(calls.pays).toHaveLength(1);

    // A read of it that fails makes no second invoice: the first may already be paid.
    setInvoice(null);
    await page.goto(`/l/${SLUG}`);
    await payButton(page).click();
    await expect(page.getByText("We could not start the payment. Try again.")).toBeVisible();
    expect(calls.pays).toHaveLength(1);

    // Once that one is paid, Pay makes another.
    setInvoice({ ...sampleInvoice(2, "paid", "pending", "Logo design", null), deposits: [] });
    await page.goto(`/l/${SLUG}`);
    await payButton(page).click();
    await expect.poll(() => calls.pays.length).toBe(2);
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
    await payButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/pay/${INVOICE.payToken}$`));
    // A retry of the same amount sends the same key, so the API makes one invoice.
    expect(calls.pays).toEqual([
      { key: expect.stringMatching(/:2500$/), body: { amountUsd: "25" } },
      { key: calls.pays[0]?.key, body: { amountUsd: "25" } },
    ]);
  });

  test("a link that is off, ended or full says why and offers no Pay", async ({ page }) => {
    for (const [state, message] of [
      ["off", "This link is off. Ask the seller for another way to pay."],
      ["ended", "This link has ended. Ask the seller for another way to pay."],
      ["full", "This link has taken all the payments it allows."],
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
