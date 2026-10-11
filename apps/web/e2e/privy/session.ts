import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, type Page } from "@playwright/test";
import { blockingViolations } from "./axe";

export const { PRIVY_TEST_EMAIL: email = "", PRIVY_TEST_OTP: code = "" } = parseEnv(
  readFileSync(".env", "utf8"),
) as Record<string, string>;

// Privy throttles a test account that signs in many times in a row, so the tests that only need to be signed in
// share one session, made once by session.setup.ts; the sign-in test itself signs in on its own.
export const session = "test-results/privy-session.json";

export async function signIn(page: Page) {
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  // The code step, before typing: axe checks it too.
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  // A pasted code with a space signs in without pressing the button.
  await page.getByRole("textbox", { name: "Code" }).fill(`${code.slice(0, 3)} ${code.slice(3)}`);
}
