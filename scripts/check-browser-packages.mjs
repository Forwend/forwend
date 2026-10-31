// R-169: @forwend/js and @forwend/react as npm would ship them. Each tarball holds only its build, readme, license and
// changelog; the browser code stays within its gzip budget; and a new project installs both tarballs offline, imports
// them in Node, renders them on the server and type-checks a use of every export.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const root = new URL("..", import.meta.url).pathname;
// Gzip bytes of each package's own code, summed over its files (D-88: about 3 KB and 2 KB).
const PACKAGES = [
  { name: "@forwend/js", dir: "packages/js", budget: 3072 },
  { name: "@forwend/react", dir: "packages/react", budget: 2048 },
];
const SHIPPED =
  /^package\/(package\.json|README\.md|LICENSE|CHANGELOG\.md|dist\/[\w-]+\.(js|d\.ts))$/;
const NEEDED = [
  "package/README.md",
  "package/LICENSE",
  "package/CHANGELOG.md",
  "package/dist/index.js",
  "package/dist/index.d.ts",
];
const TOKEN = "7f3a9c1e5b2d4086a1c3e5f7092b4d6f8a0c2e4f6a8b0d2f4e6c8a0b2d4f6e81";
// npm takes a provenance publish only when the package names the repository the workflow runs in.
const REPOSITORY = "git+https://github.com/Forwend/forwend.git";

const run = (command, args, cwd = root) =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const problems = [];

const tmp = mkdtempSync(join(tmpdir(), "forwend-packages-"));
// On any exit, Ctrl-C included.
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
process.on("SIGINT", () => process.exit(130));
try {
  run("pnpm", ["exec", "turbo", "run", "build", "--filter=@forwend/react..."]);
  const tarballs = {};
  for (const { name, dir, budget } of PACKAGES) {
    run("pnpm", ["pack", "--pack-destination", tmp], join(root, dir));
    const file = readdirSync(tmp).find(
      (f) => f.startsWith(name.slice(1).replace("/", "-")) && f.endsWith(".tgz"),
    );
    tarballs[name] = join(tmp, file);
    const entries = run("tar", ["-tzf", tarballs[name]]).trim().split("\n");
    for (const entry of entries.filter((e) => !SHIPPED.test(e)))
      problems.push(`${name} ships ${entry}`);
    for (const entry of NEEDED.filter((e) => !entries.includes(e)))
      problems.push(`${name} lacks ${entry}`);
    const manifest = JSON.parse(run("tar", ["-xOzf", tarballs[name], "package/package.json"]));
    if (manifest.repository?.url !== REPOSITORY || manifest.repository?.directory !== dir) {
      problems.push(`${name} names no repository ${REPOSITORY} at ${dir}`);
    }
    for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
      if (range.startsWith("workspace:")) problems.push(`${name} depends on ${dep}@${range}`);
    }
    const code = readdirSync(join(root, dir, "dist")).filter((f) => f.endsWith(".js"));
    const size = code.reduce(
      (sum, f) => sum + gzipSync(readFileSync(join(root, dir, "dist", f)), { level: 9 }).length,
      0,
    );
    console.log(`browser-packages: ${name} ${entries.length} files, ${size} B gzip of ${budget} B`);
    if (size > budget) problems.push(`${name} is ${size} B gzip, over its ${budget} B budget`);
  }

  const app = join(tmp, "app");
  mkdirSync(app);
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify({
      name: "forwend-packages-check",
      private: true,
      type: "module",
      dependencies: {
        "@forwend/js": `file:${tarballs["@forwend/js"]}`,
        "@forwend/react": `file:${tarballs["@forwend/react"]}`,
        "@types/react": "19.3.0",
        react: "19.3.1",
        "react-dom": "19.3.1",
      },
    }),
  );
  // @forwend/react asks for @forwend/js by version, which npm doesn't have yet: the tarball stands in.
  writeFileSync(
    join(app, "pnpm-workspace.yaml"),
    `overrides:\n  "@forwend/js": "file:${tarballs["@forwend/js"]}"\n`,
  );
  run("pnpm", ["install", "--offline", "--silent"], app);

  writeFileSync(
    join(app, "smoke.mjs"),
    `import { PAYMENT_STATUSES, mountCheckout, payUrl } from "@forwend/js";
import { Checkout, PayButton, PaymentElement } from "@forwend/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
if (typeof mountCheckout !== "function" || PAYMENT_STATUSES.paid !== "paid") throw new Error("@forwend/js exports");
const link = renderToString(createElement(PayButton, { payToken: "${TOKEN}" }));
if (!link.includes('href="' + payUrl("${TOKEN}") + '"')) throw new Error("PayButton: " + link);
// Server rendering draws the box only: the frame mounts in the browser.
for (const frame of [Checkout, PaymentElement]) renderToString(createElement(frame, { payToken: "${TOKEN}" }));
`,
  );
  run("node", ["smoke.mjs"], app);

  writeFileSync(
    join(app, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        jsx: "react-jsx",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2023",
        lib: ["ES2023", "DOM"],
        noEmit: true,
      },
      include: ["use.tsx"],
    }),
  );
  writeFileSync(
    join(app, "use.tsx"),
    `import { type CheckoutStatusEvent, mountCheckout } from "@forwend/js";
import { Checkout, PayButton, PaymentElement } from "@forwend/react";
const token = "${TOKEN}";
const onStatus = (event: CheckoutStatusEvent): string => event.paymentStatus;
export const page = (
  <>
    <PayButton payToken={token} className="pay" />
    <PayButton linkSlug="a1b2c3d4e5f6">Buy</PayButton>
    <Checkout payToken={token} onStatus={onStatus} />
    <PaymentElement payToken={token} theme="dark" onLoadError={() => undefined} />
  </>
);
export const unmount = (box: HTMLElement): (() => void) => mountCheckout(box, { payToken: token, layout: "element" }).destroy;
// @ts-expect-error a pay button takes a pay token or a payment link, not both
export const both = <PayButton payToken={token} linkSlug="a1b2c3d4e5f6" />;
`,
  );
  // Its errors go to stdout, so they show in the log.
  execFileSync(join(root, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], {
    cwd: app,
    stdio: "inherit",
  });
  console.log(
    "browser-packages: both tarballs install offline, import, render on the server and type-check",
  );
} catch (error) {
  problems.push(error.message.split("\n")[0]);
}
if (problems.length > 0) {
  console.error(`browser-packages:\n${problems.join("\n")}`);
  process.exit(1);
}
