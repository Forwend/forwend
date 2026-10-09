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

  // The shell: sidebar, top bar with the profile and theme switchers.
  await expect(page.getByRole("navigation", { name: "App" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Profile" })).toHaveText("Personal");
  await expect(page.getByRole("heading", { level: 1, name: "Personal" })).toBeVisible();
  // POST /v1/me made the personal profile and its wallet.
  await expect(page.getByText(/^0x[0-9a-f]{4}/)).toBeVisible();
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
