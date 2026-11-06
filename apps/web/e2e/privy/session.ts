import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, type Page } from "@playwright/test";
import { blockingViolations } from "./axe";

export const { PRIVY_TEST_EMAIL: email = "", PRIVY_TEST_OTP: code = "" } = parseEnv(
  readFileSync(".env", "utf8"),
) as Record<string, string>;

// Privy throttles a test account that signs in many times in a row, so the tests share one session,
// made once by session.setup.ts.
export const session = "test-results/privy-session.json";

/** The newest Confirm it's you code the api emailed the test account (R-137) and no test has read yet, from the suite's fake Resend. */
export async function freshCode(): Promise<string> {
  const port = process.env.FAKE_RESEND_PORT ?? 4319;
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`http://127.0.0.1:${port}/code?to=${encodeURIComponent(email)}`);
    if (res.ok) return ((await res.json()) as { code: string }).code;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("The api emailed no code");
}

export async function signIn(page: Page) {
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  // A pasted code with a space signs in without pressing the button.
  await page.getByRole("textbox", { name: "Code" }).fill(`${code.slice(0, 3)} ${code.slice(3)}`);
}
