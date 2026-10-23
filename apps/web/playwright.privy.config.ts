import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";

// The live suite: the real Privy test app and backend api. Privy accepts only the origin http://localhost:3000,
// so the app runs there; a dev server or api already running there is reused.
const readEnv = (path: string) => {
  try {
    return parseEnv(readFileSync(path, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
};
const web = readEnv(".env");
// The api needs neither the executor key nor the email key (only the worker sends email).
const { EXECUTOR_PRIVATE_KEY: _, RESEND_API_KEY: __, ...backend } = readEnv("../backend/.env");
const APP_URL = "http://localhost:3000";
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
      command: "go run ./cmd/api",
      cwd: "../backend",
      env: {
        ...backend,
        API_ADDR: `${apiURL.hostname}:${apiURL.port}`,
        CHAINS_FILE: "../../packages/contracts/chains.json",
        // Every test signs in as the one test account, so the suite would use up a person's limit (D-85).
        API_USER_BURST: "1000",
      },
      url: new URL("/healthz", apiURL).href,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "pnpm build && pnpm start -p 3000 -H localhost",
      url: APP_URL,
      reuseExistingServer: true,
      timeout: 240_000,
    },
  ],
});
