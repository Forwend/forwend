import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";

// The live sign-in test (e2e/privy): the real Privy test app and the real backend api. Privy accepts only the origin
// http://localhost:3000, so the app runs there and calls the api at API_URL from apps/web/.env. A dev server or api
// already running there is reused. Run by scripts/e2e.mjs when apps/web/.env has the test account.
const readEnv = (path: string) => {
  try {
    return parseEnv(readFileSync(path, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
};
const web = readEnv(".env");
const backend = readEnv("../backend/.env");
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
      // The backend's own .env (database, Privy app ID, JWKS URL and secret) on API_URL's port.
      command: "go run ./cmd/api",
      cwd: "../backend",
      env: {
        ...backend,
        API_ADDR: `${apiURL.hostname}:${apiURL.port}`,
        CHAINS_FILE: "../../packages/contracts/chains.json",
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
