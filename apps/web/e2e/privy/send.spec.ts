import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { blockingViolations } from "./axe";
import { code, session } from "./session";

// Sent comes from the worker's watcher (R-212), so this file runs one beside the api. Without the email key it sends
// no email.
let worker: ChildProcess | undefined;
test.beforeAll(() => {
  const {
    RESEND_API_KEY: _,
    EXECUTOR_PRIVATE_KEY: __,
    ...env
  } = parseEnv(readFileSync("../backend/.env", "utf8")) as Record<string, string>;
  worker = spawn("go", ["run", "./cmd/worker"], {
    cwd: "../backend",
    env: { ...process.env, ...env },
    stdio: "ignore",
    detached: true,
  });
});
test.afterAll(() => {
  // go run starts the worker as its child: end the whole group.
  if (worker?.pid) process.kill(-worker.pid, "SIGTERM");
});

/** The open sheet: its name is the current step's title. */
const sheet = (page: Page) => page.locator("dialog[open]");

/** A screenshot once the step's slide, its height and the check mark have finished. */
async function shot(page: Page, path: string, fullPage = false) {
  // The longest is the check mark: its circle, then its tick, each on duration-slow (400 ms).
  await page.waitForTimeout(900);
  await page.screenshot({ path, fullPage });
}

/** The first network and token the wallet can send; with only one, the sheet skips the choice. */
async function pickMoney(page: Page, screenshot?: string) {
  await expect(sheet(page)).toHaveAccessibleName(/^(What to send|Amount)$/);
  if ((await sheet(page).getAttribute("aria-label")) === "What to send") {
    if (screenshot) await shot(page, screenshot);
    await sheet(page)
      .getByRole("region", { name: "What to send" })
      .getByRole("button")
      .first()
      .click();
  }
  await expect(sheet(page)).toHaveAccessibleName("Amount");
}

async function confirmIfAsked(page: Page) {
  const confirm = sheet(page).getByRole("group", { name: "Confirm it's you" });
  const review = sheet(page).getByRole("button", { name: /^(Send|Transfer) \d/ });
  await expect(confirm.or(review)).toBeVisible({ timeout: 30_000 });
  if (await confirm.isVisible()) await confirm.getByRole("textbox", { name: "Code" }).fill(code);
}

test("Transfer moves testnet money to the owner's other profile and follows it to Sent", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ storageState: session });
  const page = await context.newPage();
  await page.goto("/app");
  const balance = page.getByRole("region", { name: "Total balance" });
  await balance.getByRole("button", { name: /^Transfer/ }).click();

  // R-213: Transfer opens on the owner's other profiles.
  await expect(sheet(page)).toHaveAccessibleName("Transfer");
  await sheet(page)
    .getByRole("region", { name: "Your profiles" })
    .getByRole("button")
    .first()
    .click();
  await pickMoney(page, "../../docs/runs/f425-transfer-asset-1440.png");
  await sheet(page).getByRole("textbox", { name: "Amount" }).fill("0.01");
  await expect(sheet(page).getByText("Free")).toBeVisible();
  await expect(sheet(page).getByText(/^0\.01 [A-Z]+$/)).toBeVisible();
  await shot(page, "../../docs/runs/f425-transfer-amount-1440.png");
  expect(await blockingViolations(page)).toEqual([]);
  await sheet(page).getByRole("button", { name: "Continue" }).click();
  await confirmIfAsked(page);

  // The review the server checked: Privy shows nothing of its own.
  await expect(sheet(page)).toHaveAccessibleName("Review");
  await shot(page, "../../docs/runs/f425-transfer-review-1440.png");
  expect(await blockingViolations(page)).toEqual([]);
  await sheet(page)
    .getByRole("button", { name: /^Transfer 0\.01 [A-Z]+$/ })
    .click();

  // R-214: signed with Privy in the browser, then Sent once the watcher records the transfer.
  await expect(sheet(page).getByRole("heading", { name: /^(Sending|Sent)$/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(sheet(page).getByRole("link", { name: /^View on / })).toBeVisible();
  await expect(sheet(page).getByRole("heading", { name: "Sent" })).toBeVisible({
    timeout: 150_000,
  });
  await shot(page, "../../docs/runs/f425-transfer-sent-1440.png");
  await sheet(page).getByRole("button", { name: "Done" }).click();
  await expect(sheet(page)).toHaveCount(0);
  await context.close();
});

test("Send to a new address warns and asks to check the address before it can be signed", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: session });
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await page
    .getByRole("region", { name: "Total balance" })
    .getByRole("button", { name: /^Send/ })
    .click();
  await sheet(page)
    .getByRole("button", { name: /^Wallet address/ })
    .click();
  const address = sheet(page).getByRole("textbox", { name: "Wallet address" });
  await address.fill("0x1234");
  await sheet(page).getByRole("button", { name: "Continue" }).click();
  await expect(sheet(page).getByRole("alert")).toContainText("isn't a wallet address");
  await address.fill("0x000000000000000000000000000000000000dEaD");
  await sheet(page).getByRole("button", { name: "Continue" }).click();
  await pickMoney(page);
  await sheet(page).getByRole("textbox", { name: "Amount" }).fill("0.01");
  await sheet(page).getByRole("button", { name: "Continue" }).click();
  await confirmIfAsked(page);

  const send = sheet(page).getByRole("button", { name: /^Send 0\.01 [A-Z]+$/ });
  await expect(sheet(page).getByText(/haven't sent to this address before/)).toBeVisible();
  await expect(send).toBeDisabled();
  // Every character shows, in groups of four.
  await expect(sheet(page).getByText("dEaD", { exact: true })).toBeVisible();
  await shot(page, "../../docs/runs/f425-send-review-390.png", true);
  expect(await blockingViolations(page)).toEqual([]);
  await sheet(page).getByRole("checkbox", { name: "I checked the whole address" }).check();
  await expect(send).toBeEnabled();
  // Closing gives the unsigned send up; nothing is signed.
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await context.close();
});
