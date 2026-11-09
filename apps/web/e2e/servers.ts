// Assigned once by scripts/e2e.mjs and inherited by every Playwright worker.
export const PUBLIC_PORT = Number(process.env.E2E_PUBLIC_PORT);
export const KIT_PORT = Number(process.env.E2E_KIT_PORT);
// The stub api (e2e/stub-api.mjs): the public server's proxy and the example merchant ask it.
export const API_PORT = Number(process.env.E2E_API_PORT);
// The example merchant (apps/example-merchant), at a store's allowed origin (R-170).
export const EXAMPLE_PORT = Number(process.env.E2E_EXAMPLE_PORT);
const ports = [PUBLIC_PORT, KIT_PORT, API_PORT, EXAMPLE_PORT];
if (ports.some((port) => !port) || new Set(ports).size < ports.length) {
  throw new Error("Run browser tests with pnpm --filter @forwend/web e2e");
}
export const PUBLIC_URL = `http://127.0.0.1:${PUBLIC_PORT}`;
export const KIT_URL = `http://127.0.0.1:${KIT_PORT}`;
export const API_URL = `http://127.0.0.1:${API_PORT}`;
// localhost, not 127.0.0.1: the stub allows this origin to frame a checkout.
export const EXAMPLE_URL = `http://localhost:${EXAMPLE_PORT}`;
// The example's webhook signing secret: the tests sign deliveries with it.
export const EXAMPLE_WEBHOOK_SECRET = `whsec_${Buffer.alloc(32, 5).toString("base64")}`;
// The web build's support inbox, so a test sees the address came from config.
export const SUPPORT_EMAIL = "help@example.test";

// The fake 1Click's public key for the e2e build (e2e/oneclick.ts signs with its private half): a test key with no
// value anywhere, which the page takes only on loopback (D-124).
export const ONECLICK_TEST_KEY = "ed25519:GuUpL8G3s3fCZAin42h8rNrbdJwSgvEjVcuc9Xfrbdxm";
