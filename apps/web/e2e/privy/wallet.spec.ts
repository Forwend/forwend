import { expect, test } from "@playwright/test";
import { blockingViolations } from "./axe";
import { freshCode, session } from "./session";

// R-218: the owner opens Privy's own export page for the profile's server-made wallet; Forwend never sees the key.
test("the owner opens Privy's export page for the profile wallet after the warning", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ storageState: session });
  const page = await context.newPage();
  await page.goto("/app/wallet");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Wallet" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(main.getByText(/^0x[0-9a-f]{40}$/i).first()).toBeAttached();
  expect(await blockingViolations(page)).toEqual([]);

  await main.getByRole("button", { name: "Export private key" }).click();
  const dialog = page.getByRole("dialog", { name: "Export this wallet's private key?" });
  await expect(dialog).toContainText("Anyone with this key controls this wallet");
  await dialog.getByRole("button", { name: "Show the key" }).click();
  const confirm = dialog.getByRole("group", { name: "Confirm it's you" });
  if (
    await confirm.waitFor({ timeout: 5_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await expect(confirm).toContainText("Didn't get it?", { timeout: 20_000 });
    await confirm.getByRole("textbox", { name: "Code" }).fill(await freshCode());
  }
  // Privy's own window opens over the page and connects to the wallet; its key loads in a frame on Privy's domain.
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  // Privy's window names the wallet it exports, and its copy buttons load in Privy's frame: the key is reachable there.
  // The test never presses them, so no key reaches a log.
  // Privy may first show "Connecting to your wallet", or skip it when the wallet is already connected.
  const window = page.locator("#privy-modal-content");
  await expect(window).toContainText("Export wallet", { timeout: 45_000 });
  const address =
    (
      await main
        .getByText(/^0x[0-9a-f]{40}$/i)
        .first()
        .textContent()
    )?.toLowerCase() ?? "";
  await expect(window).toContainText(`${address.slice(0, 5)}...${address.slice(-4)}`);
  // The copy buttons are Privy's own, in its frame over our page's placeholders.
  const frame = page.frameLocator("iframe[src*='embedded-wallets/export']");
  await expect(frame.getByRole("button", { name: /copy key/i })).toBeVisible({ timeout: 45_000 });
  await page.screenshot({ path: "../../docs/runs/f431-privy-export-1440.png" });

  // Closing Privy's window leaves the export ready to open again, without a reload.
  await page.keyboard.press("Escape");
  await expect(window).toBeHidden();
  await main.getByRole("button", { name: "Export private key" }).click();
  const show = dialog.getByRole("button", { name: "Show the key" });
  await expect(show).not.toHaveAttribute("aria-busy");
  await show.click();
  await expect(window).toContainText("Export wallet", { timeout: 45_000 });
  await context.close();
});
