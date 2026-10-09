import { spawn } from "node:child_process";
import { createServer } from "node:net";

// Reserve two different ports together, then pass the same pair to every test worker.
function reserve() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
const publicServer = await reserve();
const kitServer = await reserve();
const env = {
  ...process.env,
  E2E_PUBLIC_PORT: String(publicServer.address().port),
  E2E_KIT_PORT: String(kitServer.address().port),
};
await Promise.all(
  [publicServer, kitServer].map((server) => new Promise((resolve) => server.close(resolve))),
);
const child = spawn("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
