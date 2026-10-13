import { expect, test } from "@playwright/test";
import { blockingViolations } from "./axe";
import { session } from "./session";

test("a profile shows its balance, networks, receive address and activity; a new profile gets its own wallet", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: session });
  const page = await context.newPage();
  await page.goto("/app");
  const sidebar = page.locator("aside");

  // Balance: the USD total marked as an estimate, and the four actions where only Receive works today. With no
  // network enabled in this database, the card says so instead.
  const balance = page.getByRole("region", { name: "Total balance" });
  const inWallet = balance.getByRole("button", {
    name: /^Estimated: each stablecoin counts as 1 USD/,
  });
  await expect(inWallet.or(balance.getByText("No networks are enabled yet."))).toBeVisible();
  for (const action of ["Send", "Transfer", "Withdraw"]) {
    await expect(balance.getByRole("button", { name: new RegExp(`^${action}`) })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  }
  // The balance over time, from GET balance-history, with its ranges; or a reason it cannot be drawn.
  await expect(
    balance
      .getByRole("img", { name: /^Balance over the past month/ })
      .or(balance.getByText("The history shows once every balance can be read.")),
  ).toBeVisible();
  await balance.getByText("1W", { exact: true }).click();
  await expect(balance.getByRole("radio", { name: "1W" })).toBeChecked();
  await expect(page.getByRole("region", { name: "Balances by network" })).toBeVisible();
  const recent = page.getByRole("region", { name: "Recent transactions" });
  await expect(
    recent
      .getByText("No transactions yet. Money sent to or from this profile's wallet shows here.")
      .or(recent.getByRole("table")),
  ).toBeVisible();

  // Receive: the token, then the network; then a sheet with the QR code, the full address in one box and a warning
  // naming that exact network and token. The test account has USDC on Base Sepolia and Arbitrum Sepolia.
  const sheet = page.getByRole("dialog", { name: "Receive" });
  const address = sheet.locator("p", { hasText: /^0x/ });
  const qr = sheet.getByRole("img", { name: "QR code of this profile's receive address" });
  const choose = async (network: string) => {
    await sheet
      .getByRole("region", { name: "Token" })
      .getByRole("button", { name: /^USDC/ })
      .click();
    await expect(qr).toBeHidden();
    await sheet
      .getByRole("region", { name: "Network" })
      .getByRole("button", { name: network })
      .click();
    await expect(qr).toBeVisible();
    await expect(sheet.getByText(`Your ${network} address`)).toBeVisible();
    await expect(address).toHaveText(/^0x([0-9a-f]{4}){10}$/);
    await expect(sheet.getByRole("note")).toContainText(`Send only USDC on ${network}.`);
  };
  const readAddress = async () => {
    // The header's Receive works on every profile and page.
    await page.getByRole("banner").getByRole("button", { name: "Receive", exact: true }).click();
    await expect(qr).toBeHidden();
    await choose("Base Sepolia");
    expect(await blockingViolations(page)).toEqual([]);
    const text = await address.textContent();
    // The choice folds into one row; Change starts it again, and the address follows the new network.
    await sheet.getByRole("button", { name: "Change token and network" }).click();
    await choose("Arbitrum Sepolia");
    // One wallet address serves every EVM network.
    await expect(address).toHaveText(text ?? "");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    return text;
  };
  if (await inWallet.isVisible()) {
    const personalWallet = await readAddress();

    // A merchant profile, made once for the test account (each one gets a real Privy wallet), then reused.
    await sidebar.getByRole("button", { name: /^Switch profile/ }).click();
    const existing = page.getByRole("menuitemradio", { name: "Merchant · E2E shop" });
    if (await existing.count()) {
      await existing.click();
    } else {
      await page.getByRole("menuitem", { name: "New profile" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "New profile" })).toBeVisible();
      expect(await blockingViolations(page)).toEqual([]);
      await page.getByText("Merchant", { exact: true }).click();
      await page.getByRole("textbox", { name: "Name (optional)" }).fill("E2E shop");
      await page.getByRole("button", { name: "Create profile" }).click();
      await expect(page).toHaveURL("/app");
    }
    await expect(
      sidebar.getByRole("button", { name: /^Switch profile: Merchant · E2E shop/ }),
    ).toBeVisible();
    // A merchant's sidebar lists its own coming pages, and its overview is a business console.
    await expect(sidebar.getByText("Checkout")).toBeVisible();
    await expect(sidebar.getByText("Developers")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Merchant · E2E shop overview" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Received" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Payments" })).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);
    // Its own wallet: not the personal profile's address.
    expect(await readAddress()).not.toBe(personalWallet);
  }

  // The other pages of the profile.
  await sidebar.getByRole("link", { name: "Balances" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Balances" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  // Switching profile on a page other than the dashboard keeps that page.
  await sidebar.getByRole("button", { name: /^Switch profile/ }).click();
  await page.getByRole("menuitemradio", { name: "Personal" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Balances" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^Switch profile: Personal/ })).toBeVisible();
  await sidebar.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  await sidebar.getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Direction" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  await context.close();
});

test("on a phone the app is a banking-style home with a tab bar", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    storageState: session,
  });
  const page = await context.newPage();
  await page.goto("/app");
  await expect(page.locator("aside")).toBeHidden();
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => document.scrollingElement?.scrollWidth)).toBe(390);
  // Round money actions under the centered total; Receive opens the sheet.
  await page
    .getByRole("region", { name: "Total balance" })
    .getByRole("button", { name: "Receive", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Receive" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await blockingViolations(page)).toEqual([]);
  // The switcher opens as a bottom sheet with the profiles to choose from, from the tab bar.
  await tabs.getByRole("button", { name: "Profiles" }).click();
  const profilesSheet = page.getByRole("dialog", { name: "Profiles" });
  // The current profile is the one choice made, not an on/off toggle.
  await expect(profilesSheet.getByRole("button", { name: "Personal" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(profilesSheet.getByRole("link", { name: "New profile" })).toBeVisible();
  await page.keyboard.press("Escape");
  // The account opens from the top bar; on phones it carries the one dark-mode switch.
  await page
    .getByRole("banner")
    .getByRole("button", { name: /^Account: / })
    .click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Dark mode" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  // Menus are not modal: the page behind stays readable while one is open.
  expect(await blockingViolations(page)).toEqual([]);
  // The switch flips the theme and the menu stays open; the phone home passes axe in that theme too.
  const theme = await page.locator("html").getAttribute("data-theme");
  await page.getByRole("menuitemcheckbox", { name: "Dark mode" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", theme ?? "");
  await page.keyboard.press("Escape");
  expect(await blockingViolations(page)).toEqual([]);

  // A tablet turned to landscape while the profile sheet is open: the sheet closes, the page stays usable.
  await page.setViewportSize({ width: 800, height: 1100 });
  await tabs.getByRole("button", { name: "Profiles" }).click();
  await expect(page.getByRole("dialog", { name: "Profiles" })).toBeVisible();
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.getByRole("dialog", { name: "Profiles" })).toBeHidden();
  await page.locator("aside").getByRole("link", { name: "Balances" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Balances" })).toBeVisible();
  await context.close();
});
