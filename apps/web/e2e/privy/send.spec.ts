import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { blockingViolations } from "./axe";
import { freshCode, signIn } from "./session";

// Sent comes from the worker's watcher (R-212), so this file runs one beside the api. Without the email key it sends
// no email.
let worker: ChildProcess | undefined;
// Its own sign-in: a send needs one from the last 15 minutes (D-49), and earlier files' sign-ins make the shared
// session's older than the account's latest.
const fresh = "test-results/send-session.json";
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page);
  await expect(page).toHaveURL("/app", { timeout: 30_000 });
  await context.storageState({ path: fresh });
  await context.close();
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
  rmSync(fresh, { force: true });
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

// Send is held, not clicked: a press shorter than the hold does nothing.
async function holdSend(page: Page, name: RegExp) {
  const button = sheet(page).getByRole("button", { name });
  await expect(button).toBeEnabled({ timeout: 30_000 });
  const box = await button.boundingBox();
  if (!box) throw new Error("The Send button has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1_400);
  await page.mouse.up();
}

// R-137: after the hold, a stale session gets Confirm it's you as its own step; a full code confirms with no click,
// and the send is signed.
async function confirmIfAsked(page: Page) {
  const code = sheet(page).getByRole("textbox", { name: "Code" });
  const progress = sheet(page).getByRole("heading", { name: /^(Sending|Sent)$/ });
  await expect(code.or(progress)).toBeVisible({ timeout: 30_000 });
  if (await code.isVisible()) {
    await expect(sheet(page)).toHaveAccessibleName("Confirm it's you");
    await expect(sheet(page)).toContainText("We sent a code", { timeout: 20_000 });
    await code.fill(await freshCode());
  }
}

test("Transfer moves testnet money to the owner's other profile and follows it to Sent", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ storageState: fresh });
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
  await expect(sheet(page).getByText(/ available$/)).toBeVisible();
  await shot(page, "../../docs/runs/f425-transfer-amount-1440.png");
  expect(await blockingViolations(page)).toEqual([]);
  await sheet(page).getByRole("button", { name: "Continue" }).click();

  // The Summary the server checked: Privy shows nothing of its own.
  await expect(sheet(page)).toHaveAccessibleName("Summary");
  await shot(page, "../../docs/runs/f425-transfer-review-1440.png");
  expect(await blockingViolations(page)).toEqual([]);
  await holdSend(page, /^Hold to transfer 0\.01 [A-Z]+$/);
  await confirmIfAsked(page);

  // R-214: signed with Privy in the browser, then Sent once the watcher records the transfer.
  await expect(sheet(page).getByRole("heading", { name: /^(Sending|Sent)$/ })).toBeVisible({
    timeout: 60_000,
  });
  const explorer = sheet(page).getByRole("link", { name: /^View on / });
  await expect(explorer).toBeVisible();
  // R-215: the list behind the sheet has the transaction at once, as Sending or as its recorded transfer, well
  // before its 15 s poll.
  const hash = (await explorer.getAttribute("href"))?.split("/tx/")[1] ?? "";
  expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  await expect(
    page.getByRole("region", { name: "Recent transactions" }).locator(`a[href$="${hash}"]`).first(),
  ).toBeAttached({ timeout: 6_000 });
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
  const context = await browser.newContext({ storageState: fresh });
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

  const send = sheet(page).getByRole("button", { name: /^Hold to send 0\.01 [A-Z]+$/ });
  await expect(sheet(page).getByText("You haven't sent to this address before.")).toBeVisible();
  await expect(send).toBeDisabled();
  // Short in the review; the tooltip has every character.
  await sheet(page).getByRole("button", { name: "0x0000…dead", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "0x000000000000000000000000000000000000dead",
  );
  await shot(page, "../../docs/runs/f425-send-review-390.png", true);
  expect(await blockingViolations(page)).toEqual([]);
  await sheet(page).getByRole("checkbox", { name: "I checked the address" }).check();
  await expect(send).toBeEnabled();
  // Closing gives the unsigned send up; nothing is signed.
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await context.close();
});

test("Transfer opens from the command menu, and with reduced motion each step shows at once", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: fresh, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/app");
  await expect(page.getByRole("region", { name: "Total balance" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByRole("dialog", { name: "Search" });
  await search.getByRole("combobox").fill("Transfer");
  await search.getByRole("option", { name: /^Transfer/ }).click();
  await expect(sheet(page)).toHaveAccessibleName("Transfer");
  await sheet(page)
    .getByRole("region", { name: "Your profiles" })
    .getByRole("button")
    .first()
    .click();
  // The new step, or its field, takes the focus: the row that led there is gone.
  const step = sheet(page).getByRole("group", { name: /^(What to send|Amount)$/ });
  await expect(step).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.closest("dialog[open]") !== null)).toBe(
    true,
  );
  const moving = await step.evaluate(
    (el) =>
      Number.parseFloat(getComputedStyle(el.firstElementChild ?? el).animationDuration) * 1000,
  );
  expect(moving).toBeLessThan(1);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await context.close();
});

// R-216: Arc has no sponsorship, so the wallet pays its gas in the USDC it sends. The test account's business
// profile holds Arc testnet USDC.
test("On Arc the wallet pays its own fee in USDC, shown before the send, and the send reaches Sent", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ storageState: fresh });
  const page = await context.newPage();
  await page.goto("/app");
  await expect(page.getByRole("region", { name: "Total balance" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByRole("dialog", { name: "Search" });
  await search.getByRole("combobox").fill("Nmae");
  await search.getByRole("option", { name: /^Switch to Merchant/ }).click();
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Send", exact: true }),
  ).toBeVisible();
  await page.getByRole("banner").getByRole("button", { name: "Send", exact: true }).click();
  await sheet(page)
    .getByRole("region", { name: "Your profiles" })
    .getByRole("button", { name: /^Personal/ })
    .click();
  await expect(sheet(page)).toHaveAccessibleName("What to send");
  await sheet(page)
    .getByRole("button", { name: /Arc Testnet/ })
    .click();
  await expect(sheet(page)).toHaveAccessibleName("Amount");
  // The fee is the wallet's own, an estimate in USDC; the review adds the total.
  await expect(sheet(page).getByText(/^≈ \d+\.\d{4} USDC$/)).toBeVisible({ timeout: 20_000 });
  await sheet(page).getByRole("textbox", { name: "Amount" }).fill("0.01");
  await shot(page, "../../docs/runs/f427-arc-amount-1440.png");
  await sheet(page).getByRole("button", { name: "Continue" }).click();
  await expect(sheet(page)).toHaveAccessibleName("Summary");
  await expect(sheet(page).getByText("Free", { exact: true })).toHaveCount(0);
  await expect(sheet(page).getByText("Total", { exact: true })).toBeVisible();
  await shot(page, "../../docs/runs/f427-arc-review-1440.png");
  await holdSend(page, /^Hold to (send|transfer) 0\.01 USDC$/);
  await confirmIfAsked(page);
  await expect(sheet(page).getByRole("link", { name: "View on ArcScan" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(sheet(page).getByRole("heading", { name: "Sent" })).toBeVisible({
    timeout: 150_000,
  });
  await shot(page, "../../docs/runs/f427-arc-sent-1440.png");
  await context.close();
});

// R-137: a sign-in elsewhere makes this session stale; Forwend's emailed code confirms it in place, and the send goes
// on without signing out.
test("A stale session confirms it's you with Forwend's emailed code, and the send goes on", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ storageState: fresh });
  const page = await context.newPage();
  await page.goto("/app");
  await expect(page.getByRole("region", { name: "Total balance" })).toBeVisible();
  const elsewhere = await browser.newContext();
  const other = await elsewhere.newPage();
  await other.goto("/sign-in");
  await signIn(other);
  await expect(other).toHaveURL("/app", { timeout: 30_000 });
  await elsewhere.close();

  await page
    .getByRole("region", { name: "Total balance" })
    .getByRole("button", { name: /^Transfer/ })
    .click();
  await sheet(page)
    .getByRole("region", { name: "Your profiles" })
    .getByRole("button")
    .first()
    .click();
  await pickMoney(page);
  await sheet(page).getByRole("textbox", { name: "Amount" }).fill("0.01");
  // The Summary needs no fresh sign-in: Confirm it's you comes only once Send is held, as its own step.
  await sheet(page).getByRole("button", { name: "Continue" }).click();
  await expect(sheet(page)).toHaveAccessibleName("Summary", { timeout: 20_000 });
  const hold = /^Hold to transfer 0\.01 [A-Z]+$/;
  await holdSend(page, hold);
  await expect(sheet(page)).toHaveAccessibleName("Confirm it's you", { timeout: 20_000 });
  await expect(sheet(page)).toContainText("We sent a code", { timeout: 20_000 });
  await expect(sheet(page)).toContainText("Didn't get a code?");
  await shot(page, "../../docs/runs/f430-confirm-step-1440.png");
  expect(await blockingViolations(page)).toEqual([]);
  // Back gives the confirm up for the Summary, with no error; holding again asks again.
  await sheet(page).getByRole("button", { name: "Back" }).click();
  await expect(sheet(page)).toHaveAccessibleName("Summary");
  await expect(sheet(page).getByRole("alert")).toHaveCount(0);
  await holdSend(page, hold);
  await expect(sheet(page)).toHaveAccessibleName("Confirm it's you", { timeout: 20_000 });
  await sheet(page)
    .getByRole("textbox", { name: "Code" })
    .fill(await freshCode());
  await expect(sheet(page).getByRole("heading", { name: /^(Sending|Sent)$/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(sheet(page).getByRole("link", { name: /^View on / })).toBeVisible();
  await context.close();
});
