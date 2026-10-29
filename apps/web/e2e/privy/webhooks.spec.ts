import { expect, type Page, test } from "@playwright/test";
import { sidewaysScroll } from "../sideways";
import { blockingViolations } from "./axe";
import { mockApi } from "./sample-api";
import { session } from "./session";

// R-149: the API answers are mocked; the Go API tests cover the real ones.
const SHOP = "22222222-2222-2222-2222-222222222222";
const STORE = "66666666-6666-4666-8666-666666666666";
const HOOK = "cccccccc-0000-4000-8000-000000000001";
const SECRET = `whsec_${"A".repeat(43)}=`;
const OLD_SECRET = `whsec_${"B".repeat(43)}=`;
const EVENT = `evt_${"a".repeat(32)}`;
const endpoint = (endpointId: string, fields: object) => ({
  endpointId,
  url: "https://shop.example.com/hooks?token=receiver-secret",
  description: "Orders",
  storeId: null as string | null,
  events: ["invoice.paid", "invoice.settled"],
  enabled: true,
  livemode: false,
  createdAt: "2026-10-20T10:00:00Z",
  updatedAt: "2026-10-20T10:00:00Z",
  ...fields,
});
const delivery = {
  eventId: EVENT,
  type: "invoice.paid",
  invoiceId: `0x0007${"a".repeat(60)}`,
  number: 7,
  status: "failed",
  nextAttemptAt: null,
  createdAt: "2026-10-24T10:00:00Z",
  attempts: [
    { at: "2026-10-24T10:00:00Z", statusCode: 500, error: null, durationMs: 41 },
    { at: "2026-10-24T10:00:05Z", statusCode: null, error: "address not public", durationMs: 2 },
  ],
};

const writes = <T extends { method: string }>(calls: T[]) =>
  calls.filter((c) => c.method !== "GET");

async function mockWebhooks(page: Page) {
  let endpoints = [endpoint(HOOK, {})];
  const calls: { method: string; path: string; body: unknown }[] = [];
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
    if (!path.startsWith("webhooks")) return route.fallback();
    const body = request.postData() ? request.postDataJSON() : null;
    calls.push({ method: request.method(), path, body });
    if (path === "webhooks") return route.fulfill({ json: { endpoints } });
    const [, id, ...rest] = path.split("/");
    const action = rest.join("/");
    if (action === "" && request.method() === "PUT") {
      const saved = endpoint(id as string, { ...body, storeId: body.storeId ?? null });
      const known = endpoints.some((e) => e.endpointId === id);
      endpoints = known
        ? endpoints.map((e) => (e.endpointId === id ? saved : e))
        : [saved, ...endpoints];
      return route.fulfill({ status: known ? 200 : 201, json: saved });
    }
    if (action === "" && request.method() === "DELETE") {
      endpoints = endpoints.filter((e) => e.endpointId !== id);
      return route.fulfill({ status: 204 });
    }
    const one = { secret: SECRET, createdAt: "2026-10-20T10:00:00Z", expiresAt: null };
    if (action === "secret") return route.fulfill({ json: { secrets: [one] } });
    if (action === "secret/rotate") {
      return route.fulfill({
        status: 201,
        json: {
          secrets: [
            { ...one, createdAt: "2026-10-25T10:00:00Z" },
            {
              secret: OLD_SECRET,
              createdAt: "2026-10-20T10:00:00Z",
              expiresAt: "2026-10-26T10:00:00Z",
            },
          ],
        },
      });
    }
    if (action === "deliveries") return route.fulfill({ json: { deliveries: [delivery] } });
    if (action.endsWith("/resend")) return route.fulfill({ status: 204 });
    if (action === "deliveries/resend-failed") return route.fulfill({ json: { resent: 2 } });
    if (action === "test")
      return route.fulfill({ status: 201, json: { eventId: `evt_${"b".repeat(32)}` } });
    return route.fulfill({ status: 404, json: {} });
  });
  return calls;
}

test("the owner adds a webhook endpoint, turns one off, reveals and rotates its secret, and works its deliveries", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  const calls = await mockWebhooks(page);
  await page.goto("/app/developers");
  const section = page.getByRole("region", { name: "Webhooks" });
  const row = section.getByRole("row").filter({ hasText: "Orders" });
  await expect(row.getByText("shop.example.com/hooks", { exact: true })).toBeVisible();
  for (const cell of ["All stores", "Paid, Money in your wallet", "On"])
    await expect(row.getByRole("cell", { name: cell, exact: true })).toBeVisible();
  // The newest delivery is the endpoint's health at a glance.
  await expect(row.getByRole("cell", { name: /^Failed/ })).toBeVisible();
  // Every endpoint is a test one, so the panel says it once.
  await expect(section.getByText("Test mode", { exact: true })).toBeVisible();
  // The query may hold the receiver's token: the list never shows it.
  await expect(page.getByText("receiver-secret")).toHaveCount(0);
  expect(await blockingViolations(page)).toEqual([]);

  // New endpoint: the form checks the URL before it sends anything.
  await section.getByRole("button", { name: "New endpoint" }).click();
  const adding = page.getByRole("dialog", { name: "New webhook endpoint" });
  await adding.getByRole("textbox", { name: "Endpoint URL" }).fill("http://hooks.example.com");
  await adding.getByRole("button", { name: "Save endpoint" }).click();
  await expect(adding.getByText("Enter an https address of up to 2048 characters.")).toBeVisible();
  expect(writes(calls)).toEqual([]);
  await adding
    .getByRole("textbox", { name: "Endpoint URL" })
    .fill("https://hooks.example.com/forwend");
  await adding.getByRole("textbox", { name: "Description" }).fill("Fulfilment");
  await adding.getByRole("combobox", { name: "Store" }).click();
  await page.getByRole("option", { name: "Sample shop" }).click();
  await adding.getByRole("checkbox", { name: "Payment seen" }).check();
  expect(await blockingViolations(page)).toEqual([]);
  await adding.getByRole("button", { name: "Save endpoint" }).click();
  await expect(adding).toBeHidden();
  const put = writes(calls).at(-1);
  expect(put?.method).toBe("PUT");
  expect(put?.path).toMatch(/^webhooks\/[0-9a-f-]{36}$/);
  expect(put?.body).toEqual({
    url: "https://hooks.example.com/forwend",
    description: "Fulfilment",
    storeId: STORE,
    events: ["invoice.detected", "invoice.paid", "invoice.settled"],
    enabled: true,
  });
  const added = section.getByRole("row").filter({ hasText: "Fulfilment" });
  await expect(added.getByText("hooks.example.com/forwend", { exact: true })).toBeVisible();
  for (const cell of ["Sample shop", "3 events"])
    await expect(added.getByRole("cell", { name: cell, exact: true })).toBeVisible();

  const actions = () =>
    row.getByRole("button", { name: "Actions for shop.example.com/hooks" }).click();
  // Turn off keeps everything else as it was.
  await actions();
  await page.getByRole("menuitem", { name: "Turn off" }).click();
  await expect(row.getByRole("cell", { name: "Off", exact: true })).toBeVisible();
  expect(writes(calls).at(-1)).toEqual({
    method: "PUT",
    path: `webhooks/${HOOK}`,
    body: {
      url: "https://shop.example.com/hooks?token=receiver-secret",
      description: "Orders",
      events: ["invoice.paid", "invoice.settled"],
      enabled: false,
    },
  });

  // The secret shows once asked for, and is gone once closed.
  await actions();
  await page.getByRole("menuitem", { name: "Signing secret" }).click();
  const secret = page.getByRole("dialog", { name: "Signing secret" });
  await expect(secret.getByText(SECRET)).toBeVisible();
  await expect(secret.getByRole("button", { name: "Copy the signing secret" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  await secret.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(SECRET)).toHaveCount(0);

  // Rotate: the new secret, and the old one with when it stops.
  await actions();
  await page.getByRole("menuitem", { name: "Rotate secret" }).click();
  await page
    .getByRole("dialog", { name: "Rotate the secret of shop.example.com/hooks?" })
    .getByRole("button", { name: "Rotate secret" })
    .click();
  await expect(secret.getByText(OLD_SECRET)).toBeVisible();
  await expect(secret).toContainText("Also signs until");
  expect(writes(calls).at(-1)?.path).toBe(`webhooks/${HOOK}/secret/rotate`);
  await secret.getByRole("button", { name: "Done" }).click();

  // Deliveries: each attempt, a resend, a test event and a resend of the failed ones.
  await actions();
  await page.getByRole("menuitem", { name: "Deliveries" }).click();
  const sheet = page.getByRole("dialog", { name: "Deliveries to shop.example.com/hooks" });
  const sent = sheet.getByRole("listitem").filter({ hasText: "INV-0007" });
  await expect(sent).toContainText("Paid · INV-0007");
  await expect(sent).toContainText("Failed");
  await sent.getByText("2 attempts").click();
  await expect(sent).toContainText("address not public");
  await expect(sent).toContainText("500");
  await expect(sheet).toContainText("This endpoint is off");
  expect(await blockingViolations(page)).toEqual([]);
  await sent.getByRole("button", { name: /^Resend Paid INV-0007 from / }).click();
  await expect(page.getByText("Sent again")).toBeVisible();
  await sheet.getByRole("button", { name: "Send test event" }).click();
  await expect(page.getByText("Test event sent")).toBeVisible();
  await sheet.getByRole("combobox", { name: "Failed in" }).click();
  await page.getByRole("option", { name: "Last 7 days" }).click();
  const before = Date.now();
  await sheet.getByRole("button", { name: "Resend failed" }).click();
  await expect(page.getByText("2 deliveries sent again")).toBeVisible();
  const recover = writes(calls).at(-1);
  expect(recover?.path).toBe(`webhooks/${HOOK}/deliveries/resend-failed`);
  const since = Date.parse((recover?.body as { since?: string } | undefined)?.since ?? "");
  expect(Math.abs(before - 7 * 24 * 3600_000 - since)).toBeLessThan(60_000);
  expect(writes(calls).map((c) => c.path)).toContain(`webhooks/${HOOK}/deliveries/${EVENT}/resend`);
  expect(writes(calls).map((c) => c.path)).toContain(`webhooks/${HOOK}/test`);
  await sheet.getByRole("button", { name: "Close" }).click();

  // Delete asks first.
  await actions();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page
    .getByRole("dialog", { name: "Delete shop.example.com/hooks?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(row).toHaveCount(0);
  expect(writes(calls).at(-1)).toEqual({ method: "DELETE", path: `webhooks/${HOOK}`, body: null });
  await context.close();
});

test("the webhooks list and its deliveries fit a phone", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockWebhooks(page);
  await page.goto("/app/developers");
  const row = page
    .getByRole("region", { name: "Webhooks" })
    .getByRole("row")
    .filter({ hasText: "Orders" });
  await expect(row).toBeVisible();
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(await blockingViolations(page)).toEqual([]);
  await row.getByRole("button", { name: "Actions for shop.example.com/hooks" }).click();
  await page.getByRole("menuitem", { name: "Deliveries" }).click();
  await expect(
    page.getByRole("dialog", { name: "Deliveries to shop.example.com/hooks" }),
  ).toContainText("INV-0007");
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(await blockingViolations(page)).toEqual([]);
  await context.close();
});
