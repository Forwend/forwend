import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";

// The live suite: the real Privy test app and backend api. Privy accepts only the origin http://localhost:3000,
// so the app runs there. Stop local servers first: verification must run the current source.
const readEnv = (path: string) => {
  try {
    return parseEnv(readFileSync(path, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
};
const web = readEnv(".env");
// The api needs no executor key, and its email key is the fake Resend's below; the real one never reaches a test.
const { EXECUTOR_PRIVATE_KEY: _, RESEND_API_KEY: __, ...backend } = readEnv("../backend/.env");
const APP_URL = "http://localhost:3000";
// The api emails Confirm it's you codes to this stand-in for Resend, which the tests read (e2e/privy/fake-resend.mjs).
export const FAKE_RESEND_URL = `http://127.0.0.1:${process.env.FAKE_RESEND_PORT ?? 4319}`;
const apiURL = new URL(web.API_URL ?? "http://localhost:8080");

export default defineConfig({
  testDir: "./e2e/privy",
  forbidOnly: !!process.env.CI,
  // The files share one Privy test account: one worker runs them one at a time, in name order.
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 90_000,
  use: { baseURL: APP_URL, trace: "retain-on-failure" },
  projects: [
    { name: "setup", testMatch: /\.setup\.ts$/, use: { ...devices["Desktop Chrome"] } },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],
  webServer: [
    {
      command: "node e2e/privy/fake-resend.mjs",
      url: `${FAKE_RESEND_URL}/health`,
      reuseExistingServer: false,
    },
    {
      command: "go run ./cmd/api",
      cwd: "../backend",
      env: {
        ...backend,
        API_ADDR: `${apiURL.hostname}:${apiURL.port}`,
        // Every test signs in as the one test account, so the suite would use up a person's limit (D-85).
        API_USER_BURST: "1000",
        // Each run confirms it's you again, and the dev database keeps the hour's codes (D-85).
        API_CODES_PER_HOUR: "1000",
        RESEND_API_KEY: "fake",
        RESEND_API_URL: `${FAKE_RESEND_URL}/emails`,
      },
      url: new URL("/healthz", apiURL).href,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // --force: a fresh build clears .next, where an earlier `next start` of another build left cached pages that a
      // turbo cache restore would keep.
      command:
        "pnpm --workspace-root exec turbo run build --filter=@forwend/web --force && pnpm start -p 3000 -H localhost",
      // The test account has no second step set up at Privy, so the wallet MFA gate (D-49) stays off here.
      env: { NEXT_PUBLIC_WALLET_MFA: "0" },
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
