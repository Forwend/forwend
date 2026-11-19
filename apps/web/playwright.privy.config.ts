import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";

// The live suite against real Privy and the backend. Privy accepts only http://localhost:3000.
const readEnv = (path: string) => {
  try {
    return parseEnv(readFileSync(path, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
};
const web = readEnv(".env");
// The executor key and the real Resend key never reach a test.
const { EXECUTOR_PRIVATE_KEY: _, RESEND_API_KEY: __, ...backend } = readEnv("../backend/.env");
const APP_URL = "http://localhost:3000";
// The api emails sign-in codes here, and the tests read them.
export const FAKE_RESEND_URL = `http://127.0.0.1:${process.env.FAKE_RESEND_PORT ?? 4319}`;
const apiURL = new URL(web.API_URL ?? "http://localhost:8080");

export default defineConfig({
  testDir: "./e2e/privy",
  forbidOnly: !!process.env.CI,
  workers: 1, // the files share one Privy test account and run in name order
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
        API_USER_BURST: "1000", // every test signs in as the one test account
        API_CODES_PER_HOUR: "1000", // the dev database keeps the hour's codes across runs
        RESEND_API_KEY: "fake",
        RESEND_API_URL: `${FAKE_RESEND_URL}/emails`,
      },
      url: new URL("/healthz", apiURL).href,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // --force: a turbo cache restore would keep stale pages an earlier `next start` left in .next.
      command:
        "pnpm --workspace-root exec turbo run build --filter=@forwend/web --force && pnpm start -p 3000 -H localhost",
      env: { NEXT_PUBLIC_WALLET_MFA: "0" }, // the test account has no Privy MFA set up
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
