import { defineConfig, devices } from "@playwright/test";
import { API_URL, KIT_PORT, KIT_URL, PUBLIC_PORT, PUBLIC_URL } from "./e2e/servers";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "privy/**", // playwright.privy.config.ts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: PUBLIC_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Playwright starts these in order: the first builds, the second reuses that build. The public server's proxy reads
  // API_URL at run time (src/proxy.ts); the build keeps its own for the rewrite.
  webServer: [
    {
      command: `pnpm --workspace-root exec turbo run build --filter=@forwend/web && API_URL=${API_URL} pnpm start -p ${PUBLIC_PORT}`,
      url: PUBLIC_URL,
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      command: `pnpm start -p ${KIT_PORT}`,
      url: KIT_URL,
      env: { KIT_ENABLED: "1" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
