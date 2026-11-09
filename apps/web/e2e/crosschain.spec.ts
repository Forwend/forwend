import { expect, type Page, test } from "@playwright/test";
import { signedQuote } from "./oneclick";
import { MAIN_OPTION, mockInvoice, NOW, OPEN, PAY } from "./pay-invoice";
import { blockingViolations } from "./privy/axe";
import { sidewaysScroll } from "./sideways";

// A live invoice on Base mainnet (D-123): the same terms as OPEN on chain 8453, and the address predict gives them.
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BASE_RECEIVE = "0xbfb4da28f631b73c420f2c3d76e35c28ef6fb885";
const LIVE = {
  ...OPEN,
  livemode: true,
  chainId: 8453,
  token: BASE_USDC,
  receiveAddress: BASE_RECEIVE,
  options: [
    {
      ...MAIN_OPTION,
      chainId: 8453,
      network: "base",
      token: BASE_USDC,
      receiveAddress: BASE_RECEIVE,
    },
  ],
};
const TRON_USDT = "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near";
const REFUND = "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8";
const DEPOSIT_ADDRESS = "TXr9w5mDW3jqgU7Hb1a8sYr1dQf2E3GZ8n";
const TOKENS = {
  due: "1250000000",
  decimals: 6,
  tokens: [
    {
      assetId: TRON_USDT,
      blockchain: "tron",
      symbol: "USDT",
      decimals: 6,
      contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      priceUsd: "0.9991",
      estimate: "1251126013",
    },
    {
      assetId: "nep141:eth.omft.near",
      blockchain: "eth",
      symbol: "ETH",
      decimals: 18,
      contract: null,
      priceUsd: "2143.49",
      estimate: "583161106420370517",
    },
  ],
};
const TRON_TOKEN = TOKENS.tokens[0];

function quote(amountIn: string, address = DEPOSIT_ADDRESS, shownUntil = "2026-10-10T12:15:00Z") {
  return {
    quoteId: "5b0c1d2e-3f40-4a51-8b62-7c83d94ea5f6",
    token: { ...TRON_TOKEN, estimate: null },
    depositAddress: address,
    amountIn,
    minAmountIn: amountIn,
    amountOut: "1250000000",
    amountInUsd: "1263.00",
    refundFee: "5300",
    timeEstimate: 27,
    refundTo: REFUND,
    shownUntil,
    deadline: "2026-10-10T13:00:00Z",
    createdAt: "2026-10-10T12:00:00Z",
    signed: signedQuote({
      recipient: BASE_RECEIVE,
      amount: "1250000000",
      amountIn,
      originAsset: TRON_USDT,
      refundTo: REFUND,
      depositAddress: address,
    }),
  };
}

async function routeCrossChain(page: Page, quotes: object[]) {
  await page.route(`**/api/v1/invoices/${PAY}/crosschain/tokens`, (route) =>
    route.fulfill({ json: TOKENS }),
  );
  await page.route(/\/api\/v1\/invoices\/[0-9a-f]{64}\/crosschain\/price/, (route) =>
    route.fulfill({
      json: { ...quote("1263000000"), quoteId: null, depositAddress: null, signed: null },
    }),
  );
  let made = 0;
  await page.route(`**/api/v1/invoices/${PAY}/crosschain/quotes`, (route) =>
    route.fulfill({ status: 201, json: quotes[Math.min(made++, quotes.length - 1)] }),
  );
}

async function pickTronUSDT(page: Page) {
  await page.getByRole("button", { name: "Pay with another token" }).click();
  await page.getByRole("button", { name: "Choose a token" }).click();
  const picker = page.getByRole("dialog", { name: "Pay with another token" });
  await expect(picker.getByRole("button", { name: "Ethereum", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await picker.getByRole("button", { name: "Tron", exact: true }).click();
  await picker.getByRole("button", { name: /USDT.*Tron/ }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByText("1,263.00 USDT")).toBeVisible();
  await page.getByLabel("Refund address on Tron").fill(REFUND);
  await page.getByRole("button", { name: "Show address" }).click();
}

test.describe("pay with another token (R-236 to R-238)", () => {
  test("shows a verified deposit address with a 15-minute price, then asks again when it ends", async ({
    page,
  }) => {
    await page.clock.install({ time: NOW });
    await mockInvoice(page, LIVE);
    await routeCrossChain(page, [
      quote("1263000000"),
      quote("1265500000", "TNewAddress11111111111111111111111"),
    ]);
    await page.goto(`/pay/${PAY}`);
    await pickTronUSDT(page);

    await expect(page.getByText(DEPOSIT_ADDRESS)).toBeVisible();
    await expect(page.getByText("Send only USDT on Tron.")).toBeVisible();
    await expect(page.getByText("Price held 15:00")).toBeVisible();
    expect(await sidewaysScroll(page)).toBe(0);
    expect(await blockingViolations(page)).toEqual([]);

    // The price ends: the address blurs behind Get new price, and a changed amount needs Understood first (D-125).
    await page.clock.runFor(15 * 60_000);
    await expect(page.getByRole("alert").filter({ hasText: "This price expired" })).toBeVisible();
    await page.getByRole("button", { name: "Get new price" }).click();
    const changed = page.getByRole("alert").filter({ hasText: "The price changed" });
    await expect(changed).toContainText("You now send 1,265.50 USDT, not 1,263.00 USDT.");
    await expect(page.getByText("TNewAddress11111111111111111111111")).toHaveCount(0);
    await page.getByRole("button", { name: "Understood" }).click();
    await expect(page.getByText("TNewAddress11111111111111111111111")).toBeVisible();
  });

  test("shows only the address 1Click signed, and none for an answer changed after it signed", async ({
    page,
  }) => {
    await page.clock.install({ time: NOW });
    await mockInvoice(page, LIVE);
    // The api's own field names another address beside a valid signed answer: the signed one shows.
    const beside = { ...quote("1263000000"), depositAddress: "TAttacker1111111111111111111111111" };
    // The signed answer itself was changed: its signature no longer verifies, so nothing shows.
    const changed = quote("1263000000");
    (changed.signed.quote as Record<string, unknown>).depositAddress =
      "TAttacker1111111111111111111111111";
    await routeCrossChain(page, [beside]);
    await page.goto(`/pay/${PAY}`);
    await pickTronUSDT(page);
    await expect(page.getByText(DEPOSIT_ADDRESS)).toBeVisible();
    await expect(page.getByText("TAttacker1111111111111111111111111")).toHaveCount(0);

    await page.unroute(`**/api/v1/invoices/${PAY}/crosschain/quotes`);
    await page.route(`**/api/v1/invoices/${PAY}/crosschain/quotes`, (route) =>
      route.fulfill({ status: 201, json: changed }),
    );
    await page.reload();
    await pickTronUSDT(page);
    await expect(
      page.getByRole("alert").filter({ hasText: "We could not check this address" }),
    ).toBeVisible();
    await expect(page.getByText("TAttacker1111111111111111111111111")).toHaveCount(0);
  });

  test("follows a seen deposit through Converting", async ({ page }) => {
    await page.clock.install({ time: NOW });
    const q = quote("1263000000");
    const crossChain = {
      provider: "near_intents",
      quoteId: q.quoteId,
      assetId: TRON_USDT,
      blockchain: "tron",
      symbol: "USDT",
      decimals: 6,
      depositAddress: DEPOSIT_ADDRESS,
      refundTo: REFUND,
      amountIn: q.amountIn,
      minAmountIn: q.minAmountIn,
      amountOut: q.amountOut,
      status: "PROCESSING",
      deposited: "1263000000",
      delivered: null,
      refunded: null,
      refundReason: null,
      originTxs: [{ hash: "abc123", explorerUrl: "https://tronscan.org/#/transaction/abc123" }],
      destinationTxs: [],
      shownUntil: q.shownUntil,
      deadline: q.deadline,
      createdAt: q.createdAt,
      depositSeenAt: "2026-10-10T12:03:00Z",
      convertedAt: null,
      signed: q.signed,
    };
    await mockInvoice(page, { ...LIVE, crossChain });
    await page.goto(`/pay/${PAY}`);
    await expect(
      page.getByRole("heading", { name: "Payment seen on Tron. Don't pay again." }),
    ).toBeVisible();
    const steps = page.getByRole("list", { name: "Payment progress" });
    await expect(steps).toContainText("Detected");
    await expect(steps).toContainText("Converting");
    await expect(page.getByText("NEAR Intents is converting it to USDC on Base.")).toBeVisible();
    await expect(page.getByRole("link", { name: /View your transaction/ })).toHaveAttribute(
      "href",
      "https://tronscan.org/#/transaction/abc123",
    );
    // No address to pay again, and no way to switch.
    await expect(page.getByText(DEPOSIT_ADDRESS)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show address" })).toHaveCount(0);
  });

  test("is not offered on a test-mode invoice", async ({ page }) => {
    await page.clock.install({ time: NOW });
    await mockInvoice(page, OPEN);
    await page.goto(`/pay/${PAY}`);
    await expect(page.getByRole("button", { name: "Show address" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pay with another token" })).toHaveCount(0);
  });
});
