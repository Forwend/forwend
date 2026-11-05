import { expect, type Page, test } from "@playwright/test";
import { sidewaysScroll } from "../sideways";
import { blockingViolations } from "./axe";
import { mockApi } from "./sample-api";
import { code, email, session } from "./session";

// R-145: the API answers are mocked; the Go API test covers the real ones.
const SHOP = "22222222-2222-2222-2222-222222222222";
const STORE = "66666666-6666-4666-8666-666666666666";
const SECRET = `fw_test_${"A1b2C3d4E5".repeat(3)}Zz9Yx8`;
const key = (keyId: string, fields: object) => ({
  keyId,
  name: "Production server",
  storeId: STORE,
  livemode: false,
  last4: "q7Rt",
  scopes: ["invoices.read", "invoices.write"],
  createdAt: "2026-10-20T10:00:00Z",
  lastUsedAt: "2026-10-25T09:30:00Z",
  expiresAt: null as string | null,
  ...fields,
});

// The list reads again after each change, so a change is the last call that isn't a GET.
const writes = (calls: { method: string }[]) => calls.filter((c) => c.method !== "GET");

async function mockKeys(page: Page) {
  let keys = [key("aaaaaaaa-0000-4000-8000-000000000001", {})];
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
    if (!path.startsWith("keys")) return route.fallback();
    const body =
      request.method() === "GET" || request.method() === "DELETE" ? null : request.postDataJSON();
    calls.push({ method: request.method(), path, body });
    if (path === "keys" && request.method() === "GET") return route.fulfill({ json: { keys } });
    if (path === "keys") {
      const made = key("aaaaaaaa-0000-4000-8000-000000000002", {
        ...body,
        last4: SECRET.slice(-4),
        lastUsedAt: null,
      });
      keys = [made, ...keys];
      return route.fulfill({ status: 201, json: { ...made, secret: SECRET } });
    }
    const [, id, action] = path.split("/");
    if (action === "roll") {
      const old = keys.find((k) => k.keyId === id);
      const made = key("aaaaaaaa-0000-4000-8000-000000000003", {
        last4: SECRET.slice(-4),
        lastUsedAt: null,
      });
      // As the API lists only working keys: with no overlap, the old one is gone at once.
      keys = [
        made,
        ...(body.overlapHours === 0
          ? keys.filter((k) => k !== old)
          : keys.map((k) => (k === old ? { ...k, expiresAt: "2026-11-01T09:30:00Z" } : k))),
      ];
      return route.fulfill({ status: 201, json: { ...made, secret: SECRET } });
    }
    keys = keys.filter((k) => k.keyId !== id);
    return route.fulfill({ status: 204 });
  });
  return calls;
}

test("the owner makes an API key, sees its secret once, rolls a key and revokes one", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  const calls = await mockKeys(page);
  await page.goto("/app/developers");
  await expect(page.locator("aside").getByRole("link", { name: "Developers" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const main = page.getByRole("main");
  const keys = main.getByRole("region", { name: "API keys" });
  // After a roll two keys share the name, so the old one is found by the end of its text.
  const row = keys.getByRole("row").filter({ hasText: "q7Rt" });
  for (const cell of ["fw_test_…q7Rt", "Sample shop", "Read invoices, Create and change invoices"])
    await expect(row.getByRole("cell", { name: cell, exact: true })).toBeVisible();
  await expect(row.getByRole("cell").filter({ hasText: /^Oct 25/ })).toBeVisible();
  // Every key is a test key, so the panel says it once.
  await expect(keys.getByText("Test mode", { exact: true })).toBeVisible();
  // The routes name the profile, so the page shows its ID, and links the public docs (R-155).
  await expect(main.getByText(SHOP, { exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "Read the API docs" })).toHaveAttribute(
    "href",
    "/docs",
  );
  expect(await blockingViolations(page)).toEqual([]);

  // New key: the form checks the name and the scopes before it sends anything.
  await main.getByRole("button", { name: "New key" }).click();
  const dialog = page.getByRole("dialog", { name: "New API key" });
  await dialog.getByRole("checkbox", { name: "Read invoices" }).uncheck();
  await dialog.getByRole("checkbox", { name: "Create and change invoices" }).uncheck();
  await dialog.getByRole("button", { name: "Make key" }).click();
  await expect(dialog.getByText("Enter a name of up to 100 characters.")).toBeVisible();
  await expect(dialog.getByText("Pick at least one.")).toBeVisible();
  expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  await dialog.getByRole("textbox", { name: "Name" }).fill("Staging");
  await dialog.getByRole("checkbox", { name: "Read invoices" }).check();
  await dialog.getByRole("button", { name: "Make key" }).click();
  const secret = page.getByRole("dialog", { name: "Copy your key now" });
  await expect(secret.getByText(SECRET)).toBeVisible();
  await expect(secret.getByRole("button", { name: "Copy the secret key" })).toBeVisible();
  expect(writes(calls).at(-1)).toEqual({
    method: "POST",
    path: "keys",
    body: { name: "Staging", storeId: STORE, scopes: ["invoices.read"] },
  });
  expect(await blockingViolations(page)).toEqual([]);
  await secret.getByRole("button", { name: "Done" }).click();
  await expect(secret).toBeHidden();
  // Once closed, the secret is gone for good.
  await expect(page.getByText(SECRET)).toHaveCount(0);
  await expect(
    keys
      .getByRole("row")
      .filter({ hasText: "Staging" })
      .getByRole("cell", { name: "Never", exact: true }),
  ).toBeVisible();

  // Roll: the old key keeps working for the chosen overlap, and the new one's secret shows once.
  await row.getByRole("button", { name: "Actions for Production server" }).click();
  await page.getByRole("menuitem", { name: "Roll" }).click();
  const rolling = page.getByRole("dialog", { name: "Roll Production server, fw_test_…q7Rt" });
  await rolling.getByRole("combobox", { name: "The old key keeps working" }).click();
  await page.getByRole("option", { name: "For 7 days" }).click();
  await rolling.getByRole("button", { name: "Roll key" }).click();
  await expect(secret.getByText(SECRET)).toBeVisible();
  // Copy takes the focus: the key's text is what the owner came for.
  await expect(secret.getByRole("button", { name: "Copy the secret key" })).toBeFocused();
  expect(writes(calls).at(-1)).toEqual({
    method: "POST",
    path: "keys/aaaaaaaa-0000-4000-8000-000000000001/roll",
    body: { overlapHours: 168 },
  });
  await secret.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(SECRET)).toHaveCount(0);
  await expect(row.getByText(/^Stops Nov 1, 2026/)).toBeVisible();
  // A rolled key's new one rolls next; this one can only be revoked.
  await row.getByRole("button", { name: "Actions for Production server" }).click();
  await expect(page.getByRole("menuitem", { name: "Roll" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Revoke" }).click();
  const revoking = page.getByRole("dialog", { name: "Revoke Production server, fw_test_…q7Rt?" });
  await revoking.getByRole("button", { name: "Revoke" }).click();
  await expect(row).toHaveCount(0);
  expect(writes(calls).at(-1)).toEqual({
    method: "DELETE",
    path: "keys/aaaaaaaa-0000-4000-8000-000000000001",
    body: null,
  });
  await context.close();
});

test("a roll whose old key stops now still shows the new key's text", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockKeys(page);
  await page.goto("/app/developers");
  const row = page.getByRole("main").getByRole("row").filter({ hasText: "q7Rt" });
  await row.getByRole("button", { name: /^Actions for Production server/ }).click();
  await page.getByRole("menuitem", { name: "Roll" }).click();
  await page.getByRole("combobox", { name: "The old key keeps working" }).click();
  await page.getByRole("option", { name: "Stops now" }).click();
  await page.getByRole("button", { name: "Roll key" }).click();
  // The old key's row is gone with the refetch; the text still shows.
  await expect(row).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Copy your key now" }).getByText(SECRET),
  ).toBeVisible();
  await context.close();
});

test("the API keys list fits a phone", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockKeys(page);
  await page.goto("/app/developers");
  // A phone row lists the key's text under its name, in place of the wide columns.
  await expect(
    page.getByRole("main").getByText("fw_test_…q7Rt", { exact: true }).filter({ visible: true }),
  ).toHaveCount(1);
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(await blockingViolations(page)).toEqual([]);
  await context.close();
});

// R-137, D-63: the real Privy test account confirms it's them in place, in the key's own dialog; the API is mocked.
test("making a key asks to confirm it's you in place, then one sign-in covers the next change", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  const calls = await mockKeys(page);
  // The token from before the confirm is too old; any later one is the fresh sign-in's.
  const tokens: (string | null)[] = [];
  await page.route(`/api/v1/profiles/${SHOP}/keys**`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const token = await route.request().headerValue("authorization");
    tokens.push(token);
    if (token === tokens[0])
      return route.fulfill({
        status: 401,
        json: { error: { code: "reauth_required", message: "sign in again" } },
      });
    return route.fallback();
  });
  await page.goto("/app/developers");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "New key" }).click();
  const dialog = page.getByRole("dialog", { name: "New API key" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Staging");
  await dialog.getByRole("button", { name: "Make key" }).click();
  // The confirm takes the place of the dialog's buttons: no dialog on top, and the key stays in view, locked.
  const confirm = dialog.getByRole("group", { name: "Confirm it's you" });
  await expect(confirm).toContainText(`We sent a code to ${email}`);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("Staging");
  await expect(dialog.getByRole("textbox", { name: "Name" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Make key" })).toHaveCount(0);
  // The code input has the focus, as on the sign-in page.
  await expect(confirm.getByRole("textbox", { name: "Code" })).toBeFocused();
  await page.screenshot({ path: "../../docs/runs/f416-confirm-in-place-1440.png" });
  expect(await blockingViolations(page)).toEqual([]);

  // Closing the dialog mid-confirm gives up too: opened again, the form is fresh and the next try asks again.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await main.getByRole("button", { name: "New key" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("");
  await dialog.getByRole("textbox", { name: "Name" }).fill("Staging");
  await dialog.getByRole("button", { name: "Make key" }).click();
  await expect(confirm).toContainText(`We sent a code to ${email}`);
  // Cancel gives the dialog its buttons back and sends nothing more.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Make key" })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  expect(tokens).toHaveLength(2);

  await dialog.getByRole("button", { name: "Make key" }).click();
  await expect(confirm).toContainText(`We sent a code to ${email}`);
  // A wrong code: Privy refuses it, and the step stays open for another.
  const codeBox = confirm.getByRole("textbox", { name: "Code" });
  await codeBox.fill(code === "000000" ? "111111" : "000000");
  await expect(confirm.getByRole("alert")).toHaveText(
    "Wrong or expired code. Check it or send a new one.",
  );
  // An expired code: Privy's answer for it is stood in for here, as a real one takes ten minutes.
  await page.route("**/passwordless/authenticate", (route) =>
    route.fulfill({ status: 401, json: { error: "Expired code", code: "invalid_credentials" } }),
  );
  await codeBox.fill(code);
  await expect(confirm.getByRole("alert")).toHaveText(
    "Wrong or expired code. Check it or send a new one.",
  );
  await page.unroute("**/passwordless/authenticate");
  // The right code: a full one confirms with no click, and the key is made with the new token.
  await codeBox.fill("");
  await codeBox.fill(code);
  const secret = page.getByRole("dialog", { name: "Copy your key now" });
  await expect(secret.getByText(SECRET)).toBeVisible({ timeout: 15_000 });
  // Signing in again replaces this browser's Privy session, so the tests after this one share the new session.
  await context.storageState({ path: session });
  expect(tokens).toHaveLength(4);
  expect(tokens[3]).not.toEqual(tokens[0]);
  await secret.getByRole("button", { name: "Done" }).click();

  // The next protected change in the window asks nothing: it goes with the fresh sign-in's token.
  const row = main
    .getByRole("region", { name: "API keys" })
    .getByRole("row")
    .filter({ hasText: "q7Rt" });
  await row.getByRole("button", { name: "Actions for Production server" }).click();
  await page.getByRole("menuitem", { name: "Roll" }).click();
  const rolling = page.getByRole("dialog", { name: "Roll Production server, fw_test_…q7Rt" });
  await rolling.getByRole("button", { name: "Roll key" }).click();
  await expect(secret.getByText(SECRET)).toBeVisible();
  await expect(rolling.getByRole("group", { name: "Confirm it's you" })).toHaveCount(0);
  expect(tokens).toHaveLength(5);
  expect(tokens[4]).toEqual(tokens[3]);
  expect(calls.filter((c) => c.method === "POST").at(-1)?.path).toBe(
    "keys/aaaaaaaa-0000-4000-8000-000000000001/roll",
  );
  await context.close();
});
