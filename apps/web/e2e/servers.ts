// Assigned once by scripts/e2e.mjs and inherited by every Playwright worker.
export const PUBLIC_PORT = Number(process.env.E2E_PUBLIC_PORT);
export const KIT_PORT = Number(process.env.E2E_KIT_PORT);
// The api the public server's proxy asks at run time (R-168); a test that needs it listens there.
export const API_PORT = Number(process.env.E2E_API_PORT);
if (!PUBLIC_PORT || !KIT_PORT || !API_PORT || new Set([PUBLIC_PORT, KIT_PORT, API_PORT]).size < 3) {
  throw new Error("Run browser tests with pnpm --filter @forwend/web e2e");
}
export const PUBLIC_URL = `http://127.0.0.1:${PUBLIC_PORT}`;
export const KIT_URL = `http://127.0.0.1:${KIT_PORT}`;
export const API_URL = `http://127.0.0.1:${API_PORT}`;
