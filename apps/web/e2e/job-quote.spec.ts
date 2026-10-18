import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { sidewaysScroll } from "./sideways";

// R-102: the page a job's link opens. The API answers are fixed here; the Go API test covers the real ones, and the
// live suite opens a real job's link.
const TOKEN = "cd".repeat(32);
const DEPOSIT = `0x${"9".repeat(64)}`;

const blocking = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => v.id);

const payment = (position: number, title: string, amountUsd: string, more: object = {}) => ({
  position,
  title,
  amountUsd,
  dueDays: 14,
  onAccept: false,
  invoiceId: null,
  number: null,
  status: null,
  doneAt: null,
  deliveryLink: null,
  invoicedAt: null,
  paidAt: null,
  proposedAt: null,
  acceptedName: null,
  acceptedAt: null,
  ...more,
});
const quote = {
  title: "Brand identity",
  scope: "Logo, colors and a brand guide.\nTwo rounds of changes.",
  issuer: {
    name: "Alice Design GmbH",
    address: "Hauptstr. 1\n10115 Berlin",
    country: "DE",
    taxId: "DE123456789",
    email: "billing@alice.example",
  },
  payments: [
    payment(1, "Deposit", "600.00", { dueDays: 7, onAccept: true }),
    payment(2, "Final delivery", "1400.00"),
  ],
  totalUsd: "2000.00",
  acceptedName: null,
  acceptedAt: null,
  createdAt: "2026-10-18T10:00:00Z",
};
const accepted = {
  ...quote,
  acceptedName: "Jane Doe",
  acceptedAt: "2026-10-18T12:00:00Z",
  payments: [
    {
      ...quote.payments[0],
      invoiceId: DEPOSIT,
      number: 12,
      status: "open",
      invoicedAt: "2026-10-18T12:00:00Z",
    },
    quote.payments[1],
  ],
};

test.describe("job quote page", () => {
  test("shows the quote, accepts it with a typed name and email, then leads to the deposit", async ({
    page,
  }) => {
    const accepts: unknown[] = [];
    await page.route(`**/api/v1/jobs/${TOKEN}`, (route) => route.fulfill({ json: quote }));
    await page.route(`**/api/v1/jobs/${TOKEN}/accept`, async (route) => {
      accepts.push(route.request().postDataJSON());
      await page.route(`**/api/v1/jobs/${TOKEN}`, (r) => r.fulfill({ json: accepted }));
      return route.fulfill({ json: accepted });
    });
    await page.goto(`/w/${TOKEN}`);
    await expect(page.getByRole("heading", { level: 1, name: "Brand identity" })).toBeVisible();
    await expect(page.getByText("Quote from Alice Design GmbH")).toBeVisible();
    const payments = page.getByRole("region", { name: "Payments" });
    await expect(payments).toContainText("Invoiced when you accept, due 7 days after");
    await expect(payments).toContainText("Invoiced as each step is done, due 14 days after");
    await expect(payments).toContainText("2,000.00 USD");
    await expect(page.getByRole("region", { name: "The work" })).toContainText(
      "Two rounds of changes.",
    );
    await expect(page.getByRole("region", { name: "From" })).toContainText("Tax ID DE123456789");
    expect(await blocking(page)).toEqual([]);

    // Nothing typed: the name is asked for first, and nothing is sent.
    await page.getByRole("button", { name: "Accept quote" }).click();
    await expect(page.getByRole("textbox", { name: "Your name" })).toBeFocused();
    expect(accepts).toHaveLength(0);
    await page.getByRole("textbox", { name: "Your name" }).fill("Jane Doe");
    await page.getByRole("textbox", { name: "Your email" }).fill("jane@bob.example");
    await page.getByRole("button", { name: "Accept quote" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Quote accepted" })).toBeFocused();
    expect(accepts).toEqual([{ name: "Jane Doe", email: "jane@bob.example" }]);
    await expect(page.getByRole("status")).toContainText("Accepted by Jane Doe on");
    // R-104: the record lists the acceptance and the deposit it made, without the typed email.
    const record = page.getByRole("region", { name: "Record" });
    await expect(record.getByRole("listitem")).toHaveText([
      /Quote made$/,
      /Accepted by Jane Doe$/,
      /INV-0012 made for Deposit$/,
    ]);
    await expect(page.getByRole("link", { name: "Pay the deposit" })).toHaveAttribute(
      "href",
      `/pay/${DEPOSIT}`,
    );
    await expect(page.getByRole("button", { name: "Accept quote" })).toHaveCount(0);
    expect(await blocking(page)).toEqual([]);
  });

  // R-106: a change the freelancer proposed after acceptance; the client accepts it with the proposedAt the page read.
  test("accepts a waiting change with the change's proposedAt, then shows it accepted", async ({
    page,
  }) => {
    const proposedAt = "2026-10-19T09:00:00.123456Z";
    const change = payment(3, "Extra page", "150.00", { dueDays: 7, proposedAt });
    const waiting = { ...accepted, payments: [...accepted.payments, change] };
    const done = {
      ...waiting,
      totalUsd: "2150.00",
      payments: [
        ...accepted.payments,
        { ...change, acceptedName: "Jane Doe", acceptedAt: "2026-10-19T10:00:00Z" },
      ],
    };
    const posts: unknown[] = [];
    let body: object = waiting;
    await page.route(`**/api/v1/jobs/${TOKEN}`, (route) => route.fulfill({ json: body }));
    await page.route(`**/api/v1/jobs/${TOKEN}/payments/3/accept`, async (route) => {
      posts.push(route.request().postDataJSON());
      body = done;
      return route.fulfill({ json: done });
    });
    await page.goto(`/w/${TOKEN}`);
    const payments = page.getByRole("region", { name: "Payments" });
    await expect(payments).toContainText("Change · Proposed after you accepted the quote.");
    // The waiting change is not in the total until accepted.
    await expect(payments).toContainText("2,000.00 USD");
    const form = page.getByRole("form", { name: "Accept Extra page" });
    expect(await blocking(page)).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(form).toBeVisible();
    await expect.poll(() => sidewaysScroll(page)).toBeLessThanOrEqual(0);
    await form.getByRole("textbox", { name: "Your name" }).fill("Jane Doe");
    await form.getByRole("textbox", { name: "Your email" }).fill("jane@bob.example");
    await form.getByRole("button", { name: "Accept change" }).click();
    await expect(page.getByText(/^Change · Accepted by Jane Doe on/)).toBeFocused();
    expect(posts).toEqual([{ name: "Jane Doe", email: "jane@bob.example", proposedAt }]);
    await expect(payments).toContainText("2,150.00 USD");
    await expect(page.getByRole("region", { name: "Record" })).toContainText(
      "Change proposed: Extra page, 150.00 USD",
    );
    await expect(page.getByRole("region", { name: "Record" })).toContainText(
      "Extra page accepted by Jane Doe",
    );
    expect(await blocking(page)).toEqual([]);
  });

  test("names a refused email, says when the link opens nothing, and fits a phone", async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.route(`**/api/v1/jobs/${TOKEN}`, (route) => route.fulfill({ json: quote }));
    await page.route(`**/api/v1/jobs/${TOKEN}/accept`, (route) =>
      route.fulfill({
        status: 422,
        json: {
          error: {
            code: "invalid_value",
            message: "invalid job request: email must be an email address like name@example.com",
          },
        },
      }),
    );
    await page.goto(`/w/${TOKEN}`);
    await page.getByRole("textbox", { name: "Your name" }).fill("Jane Doe");
    await page.getByRole("textbox", { name: "Your email" }).fill("jane@bob.example");
    await page.getByRole("button", { name: "Accept quote" }).click();
    const email = page.getByRole("textbox", { name: "Your email" });
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
    expect(await blocking(page)).toEqual([]);

    const gone = "ef".repeat(32);
    await page.route(`**/api/v1/jobs/${gone}`, (route) =>
      route.fulfill({
        status: 404,
        json: { error: { code: "job_not_found", message: "job not found" } },
      }),
    );
    await page.goto(`/w/${gone}`);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(/This quote isn't here/);
    expect(await blocking(page)).toEqual([]);
    // A link that is not a token is no page at all.
    expect((await page.goto("/w/not-a-token"))?.status()).toBe(404);
    await context.close();
  });
});
