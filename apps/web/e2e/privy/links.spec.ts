import { expect, type Page, test } from "@playwright/test";
import { sidewaysScroll } from "../sideways";
import { blockingViolations } from "./axe";
import { mockApi } from "./sample-api";
import { session } from "./session";

// R-140: the API answers are mocked; the Go API test covers the real ones.
const SHOP = "22222222-2222-2222-2222-222222222222";
const STORE = "66666666-6666-4666-8666-666666666666";
const FIXED = "aaaaaaaa-0000-4000-8000-000000000001";
const link = (linkId: string, fields: object) => ({
  linkId,
  slug: "k3f9q2m7x1ab",
  title: "Logo design",
  storeId: STORE,
  amountUsd: null,
  minUsd: null,
  maxUsd: null,
  endsAt: null,
  maxPayments: null,
  active: true,
  visits: 0,
  paid: 0,
  createdAt: "2026-10-25T00:00:00Z",
  updatedAt: "2026-10-25T00:00:00Z",
  ...fields,
});

async function mockLinks(page: Page) {
  const links = [
    link("aaaaaaaa-0000-4000-8000-000000000002", {
      slug: "p8w2n5r4t6yz",
      title: "Top up",
      minUsd: "10.00",
      maxUsd: "500.00",
      active: false,
      visits: 1,
    }),
    link(FIXED, { amountUsd: "50.00", visits: 12, paid: 3 }),
  ];
  const saved: { linkId: string; body: Record<string, unknown> }[] = [];
  await mockApi(page);
  await page.route(`/api/v1/profiles/${SHOP}/**`, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(`/api/v1/profiles/${SHOP}/`, "");
    if (path === "stores") {
      return route.fulfill({
        json: {
          stores: [
            {
              storeId: STORE,
              name: "Sample shop",
              defaultExpiresIn: 3600,
              allowedOrigins: [],
              brandColor: null,
              logoAt: null,
              tokensOff: [],
              updatedAt: "2026-09-02T00:00:00Z",
            },
          ],
        },
      });
    }
    if (path === "links") return route.fulfill({ json: { links } });
    const id = path.startsWith("links/") ? path.slice("links/".length) : null;
    if (id && request.method() === "PUT") {
      const body = request.postDataJSON();
      saved.push({ linkId: id, body });
      const at = links.findIndex((l) => l.linkId === id);
      const made = link(id, { ...(at >= 0 ? links[at] : { slug: "n4m7v2c9x3qa" }), ...body });
      if (at >= 0) links[at] = made;
      else links.unshift(made);
      return route.fulfill({ status: at >= 0 ? 200 : 201, json: made });
    }
    return route.fallback();
  });
  return saved;
}

test("the owner lists payment links with their activity, makes an open one and turns one off", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  const saved = await mockLinks(page);
  await page.goto("/app/links");
  const main = page.getByRole("main");
  const fixed = main.getByRole("row", { name: /Logo design/ });
  await expect(fixed).toContainText("50.00 USD");
  await expect(fixed).toContainText("On");
  await expect(fixed).toContainText("12 visits, 3 paid");
  const open = main.getByRole("row", { name: /Top up/ });
  await expect(open).toContainText("10.00–500.00 USD");
  await expect(open).toContainText("Off");
  await expect(open).toContainText("1 visit, 0 paid");
  await expect(page.locator("aside").getByRole("link", { name: "Payment links" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(await blockingViolations(page)).toEqual([]);

  await main.getByRole("link", { name: "New link" }).click();
  await expect(page).toHaveURL(/\/app\/links\/new$/);
  await main.getByRole("textbox", { name: "Title" }).fill("Donations");
  await main.getByText("The payer enters it", { exact: true }).click();
  await main.getByRole("textbox", { name: "Minimum (USD, optional)" }).fill("10");
  await main.getByRole("textbox", { name: "Maximum (USD, optional)" }).fill("5");
  await main.getByRole("button", { name: "Save link" }).click();
  await expect(main.getByText("The minimum must be at most the maximum.")).toBeVisible();
  expect(saved).toEqual([]);
  expect(await blockingViolations(page)).toEqual([]);
  await main.getByRole("textbox", { name: "Maximum (USD, optional)" }).fill("500");
  await main.getByRole("button", { name: "Save link" }).click();
  // A new link opens on its page, with its address ready to copy.
  await expect(page).toHaveURL(/\/app\/links\/[0-9a-f-]{36}$/);
  expect(saved.at(-1)?.body).toEqual({
    title: "Donations",
    storeId: STORE,
    amountUsd: null,
    minUsd: "10",
    maxUsd: "500",
    endsAt: null,
    maxPayments: null,
    active: true,
  });
  await expect(main.getByText(/\/l\/n4m7v2c9x3qa$/)).toBeVisible();
  await expect(main.getByRole("button", { name: "Copy the link's address" })).toBeVisible();

  await page.goto(`/app/links/${FIXED}`);
  await main.getByRole("checkbox", { name: "The link is on" }).uncheck();
  await main.getByRole("button", { name: "Save link" }).click();
  await expect(page).toHaveURL(/\/app\/links$/);
  expect(saved.at(-1)).toEqual({
    linkId: FIXED,
    body: expect.objectContaining({ amountUsd: "50.00", minUsd: null, active: false }),
  });
  await context.close();
});

test("the payment links list fits a phone", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockLinks(page);
  await page.goto("/app/links");
  await expect(page.getByRole("main").getByText("50.00 USD · 12 visits, 3 paid")).toBeVisible();
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(await blockingViolations(page)).toEqual([]);
  await context.close();
});
