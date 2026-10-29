import { expect, test } from "@playwright/test";
import { blockingViolations } from "./axe";
import { code, email, signIn } from "./session";

for (const colorScheme of ["light", "dark"] as const) {
  test(`/sign-in has no serious or critical axe violations in the ${colorScheme} theme`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/sign-in");
    await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);
    await context.close();
  });
}

test("a wrong email address is named before any code is sent", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email" }).fill("not-an-email");
  await page.getByRole("button", { name: "Email me a code" }).click();
  const before = await page.getByRole("button", { name: "Continue with Google" }).boundingBox();
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter an email like name@example.com." }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(await page.getByRole("button", { name: "Continue with Google" }).boundingBox()).toEqual(
    before,
  );
  expect(await blockingViolations(page)).toEqual([]);
});

test("a wrong code is named on the code field, with no other error", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  const wrong = code === "000000" ? "111111" : "000000";
  await page.getByRole("textbox", { name: "Code" }).fill(wrong);
  await expect(page.getByRole("alert").filter({ hasText: "Wrong or expired code." })).toBeVisible();
  await expect(page.getByText("Google sign-in did not finish")).toHaveCount(0);
  expect(await blockingViolations(page)).toEqual([]);
});

test("a cancelled passkey prompt is named, and the other ways to sign in stay usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  // The browser's passkey prompt, cancelled by the user.
  await page.addInitScript(() => {
    const prompts = window as unknown as { passkeyPrompts: number };
    prompts.passkeyPrompts = 0;
    navigator.credentials.get = () => {
      prompts.passkeyPrompts++;
      return Promise.reject(new DOMException("The operation was cancelled.", "NotAllowedError"));
    };
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Passkey sign-in did not finish." }),
  ).toBeVisible();
  // The error came from the passkey prompt itself, not from Privy failing before it.
  expect(
    await page.evaluate(() => (window as unknown as { passkeyPrompts: number }).passkeyPrompts),
  ).toBe(1);
  await expect(page).toHaveURL("/sign-in");
  // One line even on a narrow phone, so the message never moves the centered form.
  expect(
    (await page.getByRole("alert").filter({ hasText: /./ }).boundingBox())?.height,
  ).toBeLessThanOrEqual(24);
  await expect(page.getByRole("button", { name: "Sign in with passkey" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Email me a code" })).toBeEnabled();
  expect(await blockingViolations(page)).toEqual([]);
});

test("a signed-out visit to /app goes to sign-in", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in to Forwend" })).toBeVisible();
});

test("the Privy test account signs in and lands in the app shell with its personal profile", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  const signedUp = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/me") && r.request().method() === "POST",
  );
  await signIn(page);
  await expect(page).toHaveURL("/app", { timeout: 30_000 });
  // 201 on the account's first run, 200 on every later one.
  expect([200, 201]).toContain((await signedUp).status());

  const sidebar = page.locator("aside");
  await expect(sidebar.getByRole("button", { name: /^Switch profile: Personal/ })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(sidebar.getByRole("link", { name: "My assets" })).toBeVisible();
  await expect(sidebar.getByText("Analytics")).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Analytics" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Personal overview" })).toBeAttached();
  await expect(page.getByRole("region", { name: "Total balance" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  const header = page.getByRole("banner");
  await expect(
    header.getByRole("navigation", { name: "Breadcrumb" }).getByText("Overview"),
  ).toBeVisible();
  await expect(header.getByRole("button", { name: /^Send/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await header.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("menu").getByText("Notifications")).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByRole("dialog", { name: "Search" });
  await expect(search).toBeVisible();
  await search.getByRole("combobox").fill("assets");
  expect(await blockingViolations(page)).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "My assets" })).toBeVisible();
  await sidebar.getByRole("link", { name: "Overview", exact: true }).click();

  await expect(sidebar.getByRole("switch")).toHaveCount(0);
  const theme = await page.locator("html").getAttribute("data-theme");
  // Settings is one row at the sidebar's foot, not also in the account menu.
  await expect(sidebar.getByRole("link", { name: "Settings", exact: true })).toHaveAttribute(
    "href",
    "/app/settings",
  );
  await sidebar.getByRole("button", { name: /^Account: / }).click();
  await expect(page.getByRole("menuitem", { name: "Settings" })).toHaveCount(0);
  await page.getByRole("menuitemcheckbox", { name: "Dark mode" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", theme ?? "");
  await page.keyboard.press("Escape");
  expect(await blockingViolations(page)).toEqual([]);

  await page.reload();
  await sidebar.getByRole("button", { name: /^Switch profile/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "Personal" })).toHaveCount(1);
  await page.keyboard.press("Escape");

  await page.route("**/api/v1/me", (route) => route.fulfill({ status: 500 }));
  await page.reload();
  // Next.js adds its own route announcer alert; pick ours by its text.
  await expect(
    page.getByRole("alert").filter({ hasText: "We could not load your profiles" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/sign-in");
  await page.unroute("**/api/v1/me");
  await page.goto("/app");
  await expect(page).toHaveURL("/sign-in");
});
