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
const servers = await Promise.all([reserve(), reserve()]);
const [publicPort, kitPort] = servers.map((server) => server.address().port);
const env = {
  ...process.env,
  E2E_PUBLIC_PORT: String(publicPort),
  E2E_KIT_PORT: String(kitPort),
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

// The live Privy sign-in runs only with the test account in apps/web/.env (never in CI, which has no account).
function hasTestAccount() {
  try {
    const { PRIVY_TEST_EMAIL, PRIVY_TEST_OTP } = parseEnv(readFileSync(".env", "utf8"));
    return Boolean(PRIVY_TEST_EMAIL && PRIVY_TEST_OTP);
  } catch {
    return false;
  }
}

let code = await playwright(process.argv.slice(2));
if (code === 0 && process.argv.length <= 2) {
  if (hasTestAccount()) {
    code = await playwright(["-c", "playwright.privy.config.ts"]);
  } else {
    console.log(
      "Skipped the live Privy sign-in: no PRIVY_TEST_EMAIL and PRIVY_TEST_OTP in apps/web/.env",
    );
  }
}
process.exitCode = code;
