import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const { PRIVY_TEST_EMAIL: email = "", PRIVY_TEST_OTP: code = "" } = parseEnv(
  readFileSync(".env", "utf8"),
) as Record<string, string>;

async function blockingViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

async function signIn(page: Page) {
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  // The code step, before typing: axe checks it too.
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  // A pasted code with a space signs in without pressing the button.
  await page.getByRole("textbox", { name: "Code" }).fill(`${code.slice(0, 3)} ${code.slice(3)}`);
}

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
  // Announced, and the form keeps its place.
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

test("a signed-out visit to /app goes to sign-in", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in to Forwend" })).toBeVisible();
});

test("the Privy test account signs in and lands in the app shell with its personal profile", async ({
  page,
}) => {
  await page.goto("/sign-in");
  // The real sign-in page, with Privy ready on its allowed origin.
  await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  const signedUp = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/me") && r.request().method() === "POST",
  );
  await signIn(page);
  await expect(page).toHaveURL("/app", { timeout: 30_000 });
  // The account signed up on an earlier run, so this is the repeat call: 200 with the same profile (201 the first
  // time). The backend tests cover the first signup.
  expect([200, 201]).toContain((await signedUp).status());

  // The shell: one top bar with home, the profile switcher, New profile, theme and sign out.
  await expect(page.getByRole("link", { name: "Forwend home" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Profile" })).toHaveText("Personal");
  await expect(page.getByRole("link", { name: "New profile" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Personal overview" })).toBeAttached();
  // POST /v1/me made the personal profile and its wallet: the Receive card shows it.
  await expect(page.getByRole("button", { name: "Copy address" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  const theme = await page.locator("html").getAttribute("data-theme");
  await page.getByRole("button", { name: /theme|dark|light/i }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", theme ?? "");

  // Signing in again finds the same single personal profile.
  await page.reload();
  await page.getByRole("combobox", { name: "Profile" }).click();
  await expect(page.getByRole("option", { name: "Personal" })).toHaveCount(1);
  await page.keyboard.press("Escape");

  // When the api fails, the user can retry or sign out, never stuck in the app.
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

test("a profile shows its balances, receive address and activity; a new profile gets its own wallet", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await signIn(page);
  await expect(page).toHaveURL("/app", { timeout: 30_000 });

  // Balance: the wallet amount first, with its network; with no network enabled in this database, the page says so
  // instead.
  const balance = page.getByRole("region", { name: "Balance" });
  const inWallet = balance.getByText(/In this profile's wallet on/);
  await expect(inWallet.or(balance.getByText("No networks are enabled yet."))).toBeVisible();
  if (await inWallet.isVisible()) {
    // Receive: the QR code, the full address in groups, and a warning naming one exact network and token.
    const receive = page.getByRole("region", { name: "Receive" });
    await expect(
      receive.getByRole("img", { name: "QR code of this profile's receive address" }),
    ).toBeVisible();
    await expect(receive.locator("p", { hasText: /^0x/ })).toHaveText(/^0x([0-9a-f]{4}){10}$/);
    await expect(receive.getByRole("note")).toContainText(/Send only \S+ on .+\./);
  }
  const activity = page.getByRole("region", { name: "Activity" });
  await expect(
    activity
      .getByText("No invoices yet. Invoices and their payments appear here.")
      .or(activity.getByRole("list")),
  ).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  // A merchant profile, made once for the test account (each one gets a real Privy wallet), then reused.
  const switcher = page.getByRole("combobox", { name: "Profile" });
  await switcher.click();
  const existing = page.getByRole("option", { name: "Merchant · E2E shop" });
  if (await existing.count()) {
    await existing.click();
  } else {
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "New profile" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "New profile" })).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);
    await page.getByText("Merchant", { exact: true }).click();
    await page.getByRole("textbox", { name: "Name (optional)" }).fill("E2E shop");
    await page.getByRole("button", { name: "Create profile" }).click();
    await expect(page).toHaveURL("/app");
  }
  await expect(switcher).toHaveText("Merchant · E2E shop");
  await expect(
    page.getByRole("heading", { level: 1, name: "Merchant · E2E shop overview" }),
  ).toBeAttached();
  // Its own wallet: not the personal profile's address (each read once its address is on screen).
  const address = page.getByRole("region", { name: "Receive" }).locator("p", { hasText: /^0x/ });
  await expect(address).toHaveText(/^0x([0-9a-f]{4}){10}$/);
  const merchantWallet = await address.textContent();
  await switcher.click();
  await page.getByRole("option", { name: "Personal" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Personal overview" })).toBeAttached();
  await expect(address).toHaveText(/^0x([0-9a-f]{4}){10}$/);
  expect(await address.textContent()).not.toBe(merchantWallet);
});
