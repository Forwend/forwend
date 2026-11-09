import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { PAY } from "./e2e/pay-invoice";
import {
  API_PORT,
  API_URL,
  EXAMPLE_PORT,
  EXAMPLE_URL,
  EXAMPLE_WEBHOOK_SECRET,
  KIT_PORT,
  KIT_URL,
  ONECLICK_TEST_KEY,
  PUBLIC_PORT,
  PUBLIC_URL,
  SUPPORT_EMAIL,
} from "./e2e/servers";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "privy/**", // playwright.privy.config.ts
  globalTeardown: "./e2e/unmatched.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: PUBLIC_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Playwright starts these in order: the first builds, the second reuses that build. Both the build, which fixes the
  // /api/v1 rewrite, and the proxy at run time (src/proxy.ts) read API_URL: each must point at the stub, not .env.
  webServer: [
    {
      command: `pnpm --workspace-root exec turbo run build --filter=@forwend/web && pnpm start -p ${PUBLIC_PORT}`,
      // The fake 1Click's key (e2e/oneclick.ts): the page takes it only on loopback, as these tests run (D-124).
      env: {
        NEXT_PUBLIC_SUPPORT_EMAIL: SUPPORT_EMAIL,
        API_URL,
        NEXT_PUBLIC_ONECLICK_TEST_KEY: ONECLICK_TEST_KEY,
      },
      url: PUBLIC_URL,
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      command: `pnpm start -p ${KIT_PORT}`,
      url: KIT_URL,
      env: { KIT_ENABLED: "1", API_URL },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "node e2e/stub-api.mjs",
      url: `${API_URL}/health`,
      env: { E2E_API_PORT: String(API_PORT), FORWEND_URL: PUBLIC_URL, PAY_TOKEN: PAY },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    // The example merchant (R-170), built with FORWEND_URL for its frame-src.
    {
      command: `pnpm --workspace-root exec turbo run build --filter=@forwend/example-merchant... && pnpm --filter @forwend/example-merchant exec next start -p ${EXAMPLE_PORT}`,
      url: EXAMPLE_URL,
      env: {
        FORWEND_URL: PUBLIC_URL,
        FORWEND_API_URL: API_URL,
        FORWEND_API_KEY: "fw_test_e2e",
        FORWEND_PROFILE_ID: "11111111-1111-4111-8111-111111111111",
        FORWEND_STORE_ID: "33333333-3333-4333-8333-333333333333",
        FORWEND_WEBHOOK_SECRET: EXAMPLE_WEBHOOK_SECRET,
        // A file both of its server bundles open: Next runs routes and pages apart. test-results is the run's output.
        EXAMPLE_DATABASE: fileURLToPath(
          new URL("./test-results/example-merchant.db", import.meta.url),
        ),
      },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
