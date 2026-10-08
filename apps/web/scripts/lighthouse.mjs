// Builds, serves the production site and runs Lighthouse (mobile preset) on "/".
// Fails unless Performance >= 90, Accessibility >= 95 and LCP < 2.5 s (docs/PROJECT.md R-11).
// Throttling is applied for real ("devtools": slow 4G and 4x CPU slowdown), not simulated. On a local
// server the scripts finish before the first paint, so the default simulation counts every script as
// an LCP dependency (simulated 3.1 s vs real throttled 1.5 s). See docs/PROJECT.md D-14.
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";

const PORT = 3200;
const URL_UNDER_TEST = `http://localhost:${PORT}/`;
const LIMITS = { performance: 0.9, accessibility: 0.95, lcpMs: 2500 };

const build = spawnSync("pnpm", ["build"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const server = spawn("pnpm", ["start", "-p", String(PORT)], { stdio: "ignore", detached: true });
const stop = () => {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
};

try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(URL_UNDER_TEST)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  const chrome = await chromeLauncher.launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ["--headless=new", "--no-sandbox"],
  });
  try {
    const { lhr } = await lighthouse(URL_UNDER_TEST, {
      port: chrome.port,
      onlyCategories: ["performance", "accessibility"],
      throttlingMethod: "devtools",
      output: "json",
      logLevel: "error",
    });
    const perf = lhr.categories.performance.score;
    const a11y = lhr.categories.accessibility.score;
    const lcp = lhr.audits["largest-contentful-paint"].numericValue;
    console.log(
      `performance ${Math.round(perf * 100)}, accessibility ${Math.round(a11y * 100)}, LCP ${Math.round(lcp)} ms`,
    );
    const failures = [
      perf < LIMITS.performance && `performance ${Math.round(perf * 100)} < 90`,
      a11y < LIMITS.accessibility && `accessibility ${Math.round(a11y * 100)} < 95`,
      lcp >= LIMITS.lcpMs && `LCP ${Math.round(lcp)} ms >= 2500 ms`,
    ].filter(Boolean);
    if (failures.length > 0) {
      const element =
        lhr.audits["largest-contentful-paint-element"]?.details?.items?.[0]?.items?.[0]?.node;
      const phases =
        lhr.audits["largest-contentful-paint-element"]?.details?.items?.[1]?.items ?? [];
      console.error(`LCP element: ${element?.snippet ?? "unknown"}`);
      for (const p of phases) console.error(`  ${p.phase}: ${Math.round(p.timing)} ms`);
      console.error(`Lighthouse limits missed: ${failures.join("; ")}`);
      process.exitCode = 1;
    }
  } finally {
    await chrome.kill();
  }
} finally {
  stop();
}
