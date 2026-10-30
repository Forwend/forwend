import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { parseEnv } from "node:util";

// Reserve different ports together, then pass the same ports to every test worker.
function reserve() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
const servers = await Promise.all([reserve(), reserve(), reserve()]);
const [publicPort, kitPort, apiPort] = servers.map((server) => server.address().port);
const env = {
  ...process.env,
  E2E_PUBLIC_PORT: String(publicPort),
  E2E_KIT_PORT: String(kitPort),
  E2E_API_PORT: String(apiPort),
};
await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));

function playwright(args) {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "playwright", "test", ...args], { stdio: "inherit", env });
    child.on("error", (error) => {
      console.error(error);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

// Provider checks are explicit: local credentials never expand an ordinary browser run.
const args = process.argv.slice(2);
const live = args[0] === "--live";
if (live) {
  const { PRIVY_TEST_EMAIL, PRIVY_TEST_OTP } = parseEnv(readFileSync(".env", "utf8"));
  if (!PRIVY_TEST_EMAIL || !PRIVY_TEST_OTP) {
    throw new Error("Live browser tests require PRIVY_TEST_EMAIL and PRIVY_TEST_OTP");
  }
}
process.exitCode = await playwright(
  live ? ["-c", "playwright.privy.config.ts", ...args.slice(1)] : args,
);
