import { expect, test } from "@playwright/test";
import { sidewaysScroll } from "../sideways";
import { blockingViolations } from "./axe";
import { mockApi } from "./sample-api";
import { session } from "./session";

test("a profile shows its balance, networks, receive address and activity; a new profile gets its own wallet", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: session });
  const page = await context.newPage();
  await page.goto("/app");
  const sidebar = page.locator("aside");

  // With no network enabled in this database, the card says so instead.
  const balance = page.getByRole("region", { name: "Total balance" });
  const inWallet = balance.getByRole("button", {
    name: /^Market value in USD/,
  });
  await expect(inWallet.or(balance.getByText("No networks are enabled yet."))).toBeVisible();
  for (const action of ["Send", "Transfer", "Withdraw"]) {
    await expect(balance.getByRole("button", { name: new RegExp(`^${action}`) })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  }
  // The balance's history is its own card, with its range.
  const history = page.getByRole("region", { name: "Balance", exact: true });
  await expect(
    history
      .getByRole("img", { name: /^Balance over the past month/ })
      .or(history.getByText("The history shows once every balance can be read.")),
  ).toBeVisible();
  await history.getByText("1W", { exact: true }).click();
  await expect(history.getByRole("radio", { name: "1W" })).toBeChecked();
  await expect(page.getByRole("region", { name: "My assets" })).toBeVisible();
  const recent = page.getByRole("region", { name: "Recent transactions" });
  await expect(recent.getByText("No transactions yet").or(recent.getByRole("table"))).toBeVisible();

  // The test account has USDC on Base Sepolia and Arbitrum Sepolia.
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
    // R-72: the network's name already says it is a test network.
    await expect(sheet.getByText(/test network|no real value/i)).toHaveCount(0);
  };
  const readAddress = async () => {
    await page.getByRole("banner").getByRole("button", { name: "Receive", exact: true }).click();
    await expect(qr).toBeHidden();
    await choose("Base Sepolia");
    expect(await blockingViolations(page)).toEqual([]);
    const text = await address.textContent();
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

    // Made once for the test account, then reused: each profile gets a real Privy wallet.
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
      sidebar.getByRole("button", { name: /^Switch profile: E2E shop Merchant/ }),
    ).toBeVisible();
    await expect(sidebar.getByText("Checkout")).toBeVisible();
    await expect(sidebar.getByText("Developers")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Merchant · E2E shop overview" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Received" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Latest payments" })).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);
    expect(await readAddress()).not.toBe(personalWallet);
  }

  await sidebar.getByRole("link", { name: "My assets" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My assets" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  // R-76. Wait for the URL, not a heading: the old page may still show it for a moment.
  await sidebar.getByRole("button", { name: /^Switch profile/ }).click();
  await page.getByRole("menuitemradio", { name: "Personal" }).click();
  await expect(page).toHaveURL("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Personal overview" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^Switch profile: Personal/ })).toBeVisible();
  await sidebar.getByRole("link", { name: "My assets" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My assets" })).toBeVisible();
  await sidebar.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
  await sidebar.getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible();
  // An empty list without filters shows its empty state in place of the filters.
  await expect(
    page.getByRole("group", { name: "Direction" }).or(page.locator("[data-page-empty]")),
  ).toBeVisible();
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
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  await page
    .getByRole("region", { name: "Total balance" })
    .getByRole("button", { name: "Receive", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Receive" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await blockingViolations(page)).toEqual([]);
  const more = page.getByRole("dialog", { name: "More" });
  await tabs.getByRole("button", { name: "More" }).click();
  await more.getByRole("link", { name: "Requests", exact: true }).click();
  await expect(page).toHaveURL("/app/invoices");
  await expect(more).toBeHidden();
  await tabs.getByRole("button", { name: "More" }).click();
  await expect(more.getByRole("link", { name: "Requests", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await more.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page).toHaveURL("/app/activity");
  await expect(more).toBeHidden();
  await tabs.getByRole("button", { name: "More" }).click();
  expect(await blockingViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(tabs.getByRole("button", { name: "More" })).toBeFocused();
  await tabs.getByRole("button", { name: "More" }).click();
  await page
    .getByRole("dialog", { name: "More" })
    .getByRole("button", { name: /Switch profile$/ })
    .click();
  const profilesSheet = page.getByRole("dialog", { name: "Profiles" });
  await expect(profilesSheet.getByRole("button", { name: "Personal" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(profilesSheet.getByRole("link", { name: "New profile" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tabs.getByRole("button", { name: "More" })).toBeFocused();
  await page
    .getByRole("banner")
    .getByRole("button", { name: /^Account: / })
    .click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Dark mode" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sign out", exact: true })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  const theme = await page.locator("html").getAttribute("data-theme");
  await page.getByRole("menuitemcheckbox", { name: "Dark mode" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", theme ?? "");
  await page.keyboard.press("Escape");
  expect(await blockingViolations(page)).toEqual([]);

  await page.setViewportSize({ width: 800, height: 1100 });
  await tabs.getByRole("button", { name: "More" }).click();
  await page
    .getByRole("dialog", { name: "More" })
    .getByRole("button", { name: /Switch profile$/ })
    .click();
  await expect(page.getByRole("dialog", { name: "Profiles" })).toBeVisible();
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.getByRole("dialog", { name: "Profiles" })).toBeHidden();
  await page.locator("aside").getByRole("link", { name: "My assets" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My assets" })).toBeVisible();
  await context.close();
});

test("the business balance card and Pending payments share one height, and each pending part opens Payments at its status", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: session,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await mockApi(page);
  // The innermost section holding the card's title: the card itself.
  const card = (id: string) => page.locator(`section:has(#${id})`).last();
  const pending = card("on-its-way");
  const heights = async () => {
    const [balance, parts] = await Promise.all(
      ["balance-title", "on-its-way"].map((id) => card(id).boundingBox()),
    );
    return { balance: balance?.height ?? 0, pending: parts?.height ?? 0 };
  };
  // USDC at exactly 1 USD, so each part reads its token amount (D-115).
  const fresh = new Date().toISOString();
  await page.route("**/api/v1/prices", (route) =>
    route.fulfill({
      json: {
        prices: [
          {
            chainId: 84532,
            token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
            symbol: "USDC",
            coinId: "usd-coin",
            usd: "1",
            sourceUpdatedAt: fresh,
            fetchedAt: fresh,
            stale: false,
          },
        ],
      },
    }),
  );
  await page.goto("/app");
  await expect(page.getByRole("main").getByText("18,420", { exact: false }).first()).toBeVisible();
  // Nothing pending: real zeros, with nothing to open.
  await expect(pending.locator("[data-skeleton]")).toHaveCount(0);
  await expect(pending.getByText("0.00", { exact: true })).toHaveCount(1);
  await expect(pending.getByText("0.00 USD", { exact: true })).toHaveCount(3);
  await expect(pending.getByRole("link")).toHaveCount(0);
  const empty = await heights();
  expect(Math.abs(empty.pending - empty.balance)).toBeLessThan(1);

  await page.route("**/api/v1/profiles/*/balances", (route) =>
    route.fulfill({
      json: {
        tokens: [
          {
            chainId: 84532,
            token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
            symbol: "USDC",
            decimals: 6,
            wallet: "18420350000",
            finalizedBlock: 1000,
            pending: "3500000",
            settling: "2000000",
            confirming: "1000000",
            partial: "500000",
            held: "890000",
          },
        ],
        estimatedUsdTotal: "18420.35",
      },
    }),
  );
  await page.reload();
  await expect(pending.getByText("3.50", { exact: true })).toBeVisible();
  await expect(pending.getByRole("link", { name: /0\.89 USD on hold/ })).toHaveAttribute(
    "href",
    "/app/balances",
  );
  const full = await heights();
  expect(Math.abs(full.pending - full.balance)).toBeLessThan(1);

  await expect(pending.getByRole("link", { name: "Confirming 1.00 USD" })).toHaveAttribute(
    "href",
    "/app/payments?state=confirming",
  );
  await expect(pending.getByRole("link", { name: "Partially paid 0.50 USD" })).toHaveAttribute(
    "href",
    "/app/payments?state=partially_paid",
  );
  const listed = page.waitForRequest(
    (r) =>
      /\/payments\?/.test(r.url()) &&
      new URL(r.url()).searchParams.get("settlementStatus") === "pending",
  );
  await pending.getByRole("link", { name: "Moving to wallet 2.00 USD" }).click();
  await expect(page).toHaveURL("/app/payments?settlementStatus=pending");
  await listed;
  const line = page.getByText("Paid payments whose money is still moving to your wallet.");
  await expect(line).toBeVisible();
  await page.getByRole("button", { name: "Show all payments" }).click();
  await expect(page).toHaveURL("/app/payments");
  await expect(line).toHaveCount(0);
  await context.close();
});

test("the personal balance card keeps its own height when My assets beside it is taller", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: session,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  // Five tokens: the most My assets lists, so it is taller than the balance card.
  const tokens = ["USDC", "EURC", "PYUSD", "USDT", "DAI"].map((symbol, i) => ({
    chainId: 84532,
    token: `0x${String(i + 1).repeat(40)}`,
    symbol,
    decimals: 6,
    wallet: `${(i + 1) * 1_000_000}`,
    finalizedBlock: 100,
    pending: "0",
    held: "0",
  }));
  await page.route("**/api/v1/profiles/*/balances", (route) =>
    route.fulfill({ json: { tokens, estimatedUsdTotal: "15.00" } }),
  );
  await page.goto("/app");
  const balance = page.getByRole("region", { name: "Total balance" });
  const assets = page.getByRole("region", { name: "My assets" });
  await expect(assets.getByText("DAI", { exact: true })).toBeVisible();
  const ownHeight = await balance.boundingBox();
  const beside = await assets.boundingBox();
  expect(ownHeight && beside && beside.height - ownHeight.height).toBeGreaterThan(40);
  await context.close();
});

test("pending and held summaries open the exact token balances", async ({ browser }) => {
  const context = await browser.newContext({ storageState: session });
  const page = await context.newPage();
  await page.route("**/api/v1/profiles/*/balances", (route) =>
    route.fulfill({
      json: {
        tokens: [
          {
            chainId: 84532,
            token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
            symbol: "USDC",
            decimals: 6,
            wallet: "250000",
            finalizedBlock: 100,
            pending: "200000",
            held: "750000",
          },
          {
            chainId: 42431,
            token: "0x20c0000000000000000000006a37da5c996874be",
            symbol: "OUSD",
            decimals: 6,
            wallet: "26000000",
            finalizedBlock: 100,
            pending: "0",
            held: "20000",
          },
        ],
        estimatedUsdTotal: "26.25",
      },
    }),
  );
  // Both tokens at exactly 1 USD, so the totals are the token amounts (D-115).
  const fresh = new Date().toISOString();
  await page.route("**/api/v1/prices", (route) =>
    route.fulfill({
      json: {
        prices: [
          ["84532", "0x036cbd53842c5426634e7929541ec2318f3dcf7e", "USDC", "usd-coin"],
          ["42431", "0x20c0000000000000000000006a37da5c996874be", "OUSD", "open-usd"],
        ].map(([chainId, token, symbol, coinId]) => ({
          chainId: Number(chainId),
          token,
          symbol,
          coinId,
          usd: "1",
          sourceUpdatedAt: fresh,
          fetchedAt: fresh,
          stale: false,
        })),
      },
    }),
  );
  await page.goto("/app");
  const balance = page.getByRole("region", { name: "Total balance" });
  await expect(balance.getByText("26.25", { exact: true })).toBeVisible();
  await expect(
    balance.getByRole("link", { name: "0.20 USD moving to your wallet" }),
  ).toHaveAttribute("href", "/app/balances");
  await balance.getByRole("link", { name: "0.77 USD on hold" }).click();
  await expect(page).toHaveURL("/app/balances");
  const usdc = page.getByRole("listitem").filter({ hasText: "USDC" });
  const ousd = page.getByRole("listitem").filter({ hasText: "OUSD" });
  await expect(usdc.getByText("0.20", { exact: true })).toBeVisible();
  await expect(usdc.getByText("0.75", { exact: true })).toBeVisible();
  await expect(ousd.getByText("0.02", { exact: true })).toBeVisible();
  await context.close();
});
