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
      json: {
        ...quote("1263000000"),
        minAmountIn: "1252000000",
        quoteId: null,
        depositAddress: null,
        signed: null,
      },
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
  // The cost is the least 1Click converts over what arrives: the slippage on top comes back unused.
  await expect(
    page.getByText("Conversion cost about 2.00 USD · Arrives in about a minute"),
  ).toBeVisible();
  await expect(page.getByText(/^Use your own wallet, not an exchange\./)).toBeVisible();
  await page.getByLabel("Refund address on Tron").fill(REFUND);
  await page.getByRole("button", { name: "Show address" }).click();
}

test.describe("pay with another token (R-236 to R-238)", () => {
  test("shows a verified deposit address with a 15-minute price, then asks again when it ends", async ({
    page,
  }) => {
    await page.clock.install({ time: NOW });
    await mockInvoice(page, LIVE);
    const second = "TNewAddress11111111111111111111111";
    const third = "TThirdAddress111111111111111111111";
    await routeCrossChain(page, [
      quote("1263000000"),
      quote("1265500000", second, "2026-10-10T12:30:00Z"),
      quote("1265500000", third, "2026-10-10T12:45:00Z"),
    ]);
    await page.goto(`/pay/${PAY}`);
    await pickTronUSDT(page);

    await expect(page.getByText(DEPOSIT_ADDRESS)).toBeVisible();
    await expect(page.getByText("Send only USDT on Tron.")).toBeVisible();
    await expect(page.getByText("Price held 15:00")).toBeVisible();
    expect(await sidewaysScroll(page)).toBe(0);
    expect(await blockingViolations(page)).toEqual([]);

    // The price ends: the address blurs behind Get new price and can't be reached or copied (D-125).
    await page.clock.runFor(15 * 60_000);
    await expect(page.getByRole("alert").filter({ hasText: "This price expired" })).toBeVisible();
    const copy = page.getByRole("button", { name: /Copy/ }).first();
    await copy.focus();
    await expect(copy).not.toBeFocused();
    expect(await blockingViolations(page)).toEqual([]);
    // A changed amount needs Understood before its address shows.
    await page.getByRole("button", { name: "Get new price" }).click();
    const changed = page.getByRole("alert").filter({ hasText: "The price changed" });
    await expect(changed).toContainText("You now send 1,265.50 USDT, not 1,263.00 USDT.");
    await expect(page.getByText(second)).toHaveCount(0);
    await page.getByRole("button", { name: "Understood" }).click();
    await expect(page.getByText(second)).toBeVisible();
    await expect(page.getByText("This price expired")).toHaveCount(0);
    // The same amount again shows its new address at once, and says it is new.
    await page.clock.runFor(15 * 60_000);
    await page.getByRole("button", { name: "Get new price" }).click();
    await expect(page.getByText(third)).toBeVisible();
    await expect(page.getByText("New address. Send only to this one.")).toBeVisible();
    await expect(page.getByText(second)).toHaveCount(0);
  });

  test("lists chains as chips on a phone and beside the tokens on a large screen", async ({
    page,
  }) => {
    await page.clock.install({ time: NOW });
    await mockInvoice(page, LIVE);
    await routeCrossChain(page, [quote("1263000000")]);
    for (const [width, direction, search] of [
      [390, "row", false],
      [1280, "column", true],
    ] as const) {
      await page.setViewportSize({ width, height: 860 });
      await page.goto(`/pay/${PAY}`);
      await page.getByRole("button", { name: "Pay with another token" }).click();
      await page.getByRole("button", { name: "Choose a token" }).click();
      const picker = page.getByRole("dialog", { name: "Pay with another token" });
      const chains = picker.getByRole("region", { name: "Chains" }).getByRole("list");
      await expect(chains).toHaveCSS("flex-direction", direction);
      await expect(picker.getByRole("searchbox", { name: "Search chains" })).toBeVisible({
        visible: search,
      });
      expect(await sidewaysScroll(page)).toBe(0);
    }
  });

  test("greys a token that needs more than is due, with its minimum, and it can't be picked (R-242)", async ({
    page,
  }) => {
    await page.clock.install({ time: NOW });
    await mockInvoice(page, LIVE);
    await routeCrossChain(page, [quote("1263000000")]);
    const TRX = {
      assetId: "nep141:tron.omft.near",
      blockchain: "tron",
      symbol: "TRX",
      decimals: 6,
      contract: null,
      priceUsd: "0.3",
      estimate: "4170000000",
      minimum: null,
    };
    await page.route(`**/api/v1/invoices/${PAY}/crosschain/tokens`, (route) =>
      route.fulfill({
        json: {
          ...TOKENS,
          tokens: [
            { ...TRON_TOKEN, minimum: "1999995000" },
            TRX,
            { ...TOKENS.tokens[1], minimum: TOKENS.due },
          ],
        },
      }),
    );
    await page.goto(`/pay/${PAY}`);
    await page.getByRole("button", { name: "Pay with another token" }).click();
    await page.getByRole("button", { name: "Choose a token" }).click();
    const picker = page.getByRole("dialog", { name: "Pay with another token" });
    // Ethereum's ETH needs exactly what is due, so it fits: nothing is greyed, so no note.
    await expect(picker.getByRole("button", { name: /ETH/ })).toBeEnabled();
    await expect(picker.getByText(/Greyed tokens/)).toHaveCount(0);
    await picker.getByRole("button", { name: "Tron", exact: true }).click();
    const rows = picker.getByRole("region", { name: "Tokens on Tron" }).getByRole("listitem");
    // The token that fits comes first; the other stays listed with what it needs.
    await expect(rows.nth(0)).toContainText("TRX");
    const usdt = rows.nth(1).getByRole("button");
    await expect(usdt).toContainText("Tron · Needs at least 2,000.00 USDC");
    await expect(usdt).toBeDisabled();
    await expect(
      picker.getByText(
        "Greyed tokens need more than this payment of 1,250.00 USDC. NEAR Intents sets the minimum for each.",
      ),
    ).toBeVisible();
    await rows.nth(0).getByRole("button").click();
    await expect(picker).toHaveCount(0);
    await expect(page.getByLabel("Refund address on Tron")).toBeVisible();
  });

  test("a price NEAR Intents refuses says the token can't be converted, not the refund address (R-242)", async ({
    page,
  }) => {
    await page.clock.install({ time: NOW });
    await mockInvoice(page, LIVE);
    await routeCrossChain(page, [quote("1263000000")]);
    await page.route(/\/api\/v1\/invoices\/[0-9a-f]{64}\/crosschain\/price/, (route) =>
      route.fulfill({
        status: 422,
        json: {
          error: {
            code: "invalid_value",
            message: "invalid invoice request: originAsset: 1Click can't convert this token now",
          },
        },
      }),
    );
    await page.goto(`/pay/${PAY}`);
    await page.getByRole("button", { name: "Pay with another token" }).click();
    await page.getByRole("button", { name: "Choose a token" }).click();
    const picker = page.getByRole("dialog", { name: "Pay with another token" });
    await picker.getByRole("button", { name: "Tron", exact: true }).click();
    await picker.getByRole("button", { name: /USDT.*Tron/ }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "NEAR Intents can't convert this token now" }),
    ).toBeVisible();
    await expect(page.getByText(/refund to this address/)).toHaveCount(0);
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

  // R-240: the payee's switch stops only new quotes, so a seen deposit leads the box either way.
  for (const crossChainOn of [true, false])
    test(`follows a seen deposit through Converting, the payee's switch ${crossChainOn ? "on" : "off"}`, async ({
      page,
    }) => {
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
        // 1Click can name its plan while converting: nothing has arrived on Base until it succeeds.
        delivered: "1250000000",
        refunded: null,
        refundReason: null,
        originTxs: [{ hash: "abc123", explorerUrl: "https://tronscan.org/#/transaction/abc123" }],
        destinationTxs: [{ hash: `0x${"9".repeat(64)}`, explorerUrl: "" }],
        shownUntil: q.shownUntil,
        deadline: q.deadline,
        createdAt: q.createdAt,
        depositSeenAt: "2026-10-10T12:03:00Z",
        convertedAt: null,
        signed: q.signed,
      };
      await mockInvoice(page, { ...LIVE, crossChain, crossChainOn });
      await page.goto(`/pay/${PAY}`);
      await expect(
        page.getByRole("heading", { name: "Payment seen on Tron. Don't pay again." }),
      ).toBeVisible();
      const steps = page.getByRole("list", { name: "Payment progress" }).getByRole("listitem");
      await expect(steps.nth(0)).toContainText("Detected, done");
      await expect(steps.nth(1)).toHaveAttribute("aria-current", "step");
      await expect(steps.nth(1)).toContainText("Converting");
      await expect(page.getByText("NEAR Intents is converting it to USDC on Base.")).toBeVisible();
      // What was sent, with 1Click's own link where no known explorer takes the hash.
      await expect(page.getByText("1,263.00 USDT on Tron")).toBeVisible();
      await expect(page.getByRole("link", { name: "View transaction on Tron" })).toHaveAttribute(
        "href",
        "https://tronscan.org/#/transaction/abc123",
      );
      await expect(page.getByText("Arrived on Base")).toHaveCount(0);
      await expect(page.getByRole("link", { name: /Basescan/ })).toHaveCount(0);
      // No address to pay again, and no way to switch.
      await expect(page.getByText(DEPOSIT_ADDRESS)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Show address" })).toHaveCount(0);
    });

  test("on Base it confirms as a direct payment does, and lists what was sent, what arrived and what came back (R-243)", async ({
    page,
  }) => {
    await page.clock.install({ time: NOW });
    // ETH has 18 decimals, so the payer's amounts can't pass for Base USDC's 6.
    const ethTx = `0x${"7".repeat(64)}`;
    const baseTx = `0x${"9".repeat(64)}`;
    const onBase = {
      txHash: baseTx,
      logIndex: 0,
      from: "0x8ba1f109551bd432803012645ac136ddd64dba72",
      amount: "1250000000",
      blockNumber: 100,
      blockTime: "2026-10-10T12:03:00Z",
      status: "detected",
      late: false,
      paid: null,
      blocksLeft: 1200,
      blocksTotal: 4400,
      secondsLeft: 600,
    };
    await mockInvoice(page, {
      ...LIVE,
      paymentStatus: "detected",
      confirming: true,
      deposits: [onBase],
      options: [{ ...LIVE.options[0], deposits: [onBase] }],
      crossChain: kept(quote("1263000000"), {
        blockchain: "eth",
        symbol: "ETH",
        decimals: 18,
        status: "SUCCESS",
        deposited: "583161106420370517",
        delivered: "1250000000",
        refunded: "1000000000000000",
        originTxs: [{ hash: ethTx, explorerUrl: "" }],
        destinationTxs: [{ hash: baseTx, explorerUrl: "" }],
        depositSeenAt: "2026-10-10T12:01:00Z",
        convertedAt: "2026-10-10T12:02:00Z",
      }),
    });
    await page.goto(`/pay/${PAY}`);
    const steps = page.getByRole("list", { name: "Payment progress" }).getByRole("listitem");
    await expect(steps.nth(1)).toContainText("Converting, done");
    await expect(steps.nth(2)).toHaveAttribute("aria-current", "step");
    await expect(
      page.getByRole("status").filter({ hasText: "Confirming (3,200/4,400)" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "About 10 min left" })).toBeVisible();
    await expect(page.getByText(/^Final around /)).toBeVisible();
    const row = (label: string) => page.getByRole("listitem").filter({ hasText: label });
    await expect(row("You sent")).toContainText("0.583161106420370517 ETH on Ethereum");
    await expect(
      row("You sent").getByRole("link", { name: "View transaction on Etherscan" }),
    ).toHaveAttribute("href", `https://etherscan.io/tx/${ethTx}`);
    await expect(row("Arrived on Base")).toContainText("1,250.00 USDC");
    await expect(
      row("Arrived on Base").getByRole("link", { name: "View transaction on Basescan" }),
    ).toHaveAttribute("href", `https://basescan.org/tx/${baseTx}`);
    await expect(row("Returned to you")).toContainText("0.001 ETH");
  });

  test("on Base, final but not yet booked, it says what the direct box says (R-243)", async ({
    page,
  }) => {
    await page.clock.install({ time: NOW });
    const booked = {
      txHash: `0x${"9".repeat(64)}`,
      logIndex: 0,
      from: "0x8ba1f109551bd432803012645ac136ddd64dba72",
      amount: "1250000000",
      blockNumber: 100,
      blockTime: "2026-10-10T12:03:00Z",
      status: "confirmed",
      late: false,
      paid: null,
      blocksLeft: 0,
      blocksTotal: 0,
      secondsLeft: 0,
    };
    await mockInvoice(page, {
      ...LIVE,
      paymentStatus: "detected",
      deposits: [booked],
      options: [{ ...LIVE.options[0], deposits: [booked] }],
      crossChain: kept(quote("1263000000"), {
        status: "SUCCESS",
        delivered: "1250000000",
        destinationTxs: [{ hash: booked.txHash, explorerUrl: "" }],
        depositSeenAt: "2026-10-10T12:01:00Z",
        convertedAt: "2026-10-10T12:02:00Z",
      }),
    });
    await page.goto(`/pay/${PAY}`);
    await expect(
      page.getByRole("status").filter({ hasText: "Awaiting confirmation." }),
    ).toBeVisible();
    // No time is promised while the ledger books it.
    await expect(page.getByText(/left$/)).toHaveCount(0);
    await expect(page.getByText(/^Final around /)).toHaveCount(0);
  });

  test("once an address shows, Change and Pay directly instead take two presses (R-243, R-68)", async ({
    page,
  }) => {
    await page.clock.install({ time: NOW });
    await mockInvoice(page, LIVE);
    await routeCrossChain(page, [quote("1263000000")]);
    await page.goto(`/pay/${PAY}`);
    // Before an address, the way back takes one press.
    await page.getByRole("button", { name: "Pay with another token" }).click();
    await page.getByRole("button", { name: "Pay directly instead" }).click();
    await expect(page.getByRole("button", { name: "Pay with another token" })).toBeVisible();
    await page.getByRole("button", { name: "Pay with another token" }).click();
    await page.getByRole("button", { name: "Choose a token" }).click();
    const picker = page.getByRole("dialog", { name: "Pay with another token" });
    await picker.getByRole("button", { name: "Tron", exact: true }).click();
    await picker.getByRole("button", { name: /USDT.*Tron/ }).click();
    // Before an address, one press opens the picker.
    await page.getByRole("button", { name: "Change", exact: true }).click();
    await expect(picker).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByLabel("Refund address on Tron").fill(REFUND);
    await page.getByRole("button", { name: "Show address" }).click();
    await expect(page.getByText(DEPOSIT_ADDRESS)).toBeVisible();
    const change = page.getByRole("button", { name: "Change", exact: true });
    await change.click();
    await expect(picker).toHaveCount(0);
    // As the direct Change: moving away puts it back, and the address stays.
    const confirm = page.getByRole("button", { name: "Confirm change" });
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(change).toBeVisible();
    await expect(page.getByText(DEPOSIT_ADDRESS)).toBeVisible();
    await change.click();
    await confirm.click();
    await expect(picker).toBeVisible();
  });

  test("is not offered when the payee turned it off (R-240)", async ({ page }) => {
    await page.clock.install({ time: NOW });
    await mockInvoice(page, { ...LIVE, crossChainOn: false });
    await page.goto(`/pay/${PAY}`);
    await expect(page.getByRole("button", { name: "Show address" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pay with another token" })).toHaveCount(0);
  });

  test("is not offered on a test-mode invoice", async ({ page }) => {
    await page.clock.install({ time: NOW });
    await mockInvoice(page, OPEN);
    await page.goto(`/pay/${PAY}`);
    await expect(page.getByRole("button", { name: "Show address" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pay with another token" })).toHaveCount(0);
  });

  test("a returned payment leaves one line, and the invoice can be paid again", async ({
    page,
  }) => {
    const q = quote("1263000000");
    await page.clock.install({ time: NOW });
    await routeCrossChain(page, [q]);
    for (const [status, line] of [
      ["REFUNDED", "NEAR Intents returned the money to your refund address."],
      ["FAILED", "The conversion failed. NEAR Intents returns the money to your refund address."],
      [
        "INCOMPLETE_DEPOSIT",
        "Less than needed arrived. NEAR Intents returns it to your refund address.",
      ],
    ] as const) {
      await page.unroute("**/api/v1/invoices/*");
      await mockInvoice(page, {
        ...LIVE,
        crossChain: kept(q, { status, depositSeenAt: "2026-10-10T11:50:00Z" }),
      });
      await page.goto(`/pay/${PAY}`);
      await expect(page.getByRole("status").filter({ hasText: line })).toContainText(
        `Quote ID for support: ${q.quoteId}`,
      );
      await expect(page.getByText("Don't pay again")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Show address" })).toBeVisible();
      // Another token again: a price for the kept token, then the refund address.
      await page.getByRole("button", { name: "Pay with another token" }).click();
      await expect(page.getByText("You send")).toBeVisible();
    }
  });

  // A quote 1Click returned didn't pay: the payer paid on Base after it, and the receipt says nothing of it. Nor did
  // one whose USDC came after money on another option was recorded: that USDC is held for the payer.
  // The second option pay.spec.ts derives from these terms, so the page's address check passes.
  const ARBITRUM = {
    ...MAIN_OPTION,
    optionId: "0x285391c5b8b001b41a459f4011b40661d4c83c871d3f0d7881682bbced83a1c1",
    chainId: 421614,
    network: "arbitrum-sepolia",
    token: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
    receiveAddress: "0x1109f4fabb1748c2ce1858b2aaf8442523cfeeb0",
  };
  for (const [name, status, recorded] of [
    ["SUCCESS", "SUCCESS", LIVE.optionId],
    ["REFUNDED", "REFUNDED", LIVE.optionId],
    ["paid on another option first", "SUCCESS", ARBITRUM.optionId],
  ] as const)
    test(`the receipt names what the payer paid with only once 1Click delivered (${name})`, async ({
      page,
    }) => {
      const named = name === "SUCCESS";
      await page.clock.install({ time: NOW });
      await mockInvoice(page, {
        ...LIVE,
        options: [...LIVE.options, ARBITRUM],
        optionLocked: true,
        // The invoice reads as the option money was recorded on.
        ...(recorded === ARBITRUM.optionId
          ? {
              chainId: ARBITRUM.chainId,
              token: ARBITRUM.token,
              receiveAddress: ARBITRUM.receiveAddress,
            }
          : {}),
        optionId: recorded,
        paymentStatus: "paid",
        settlementStatus: "pending",
        paidAt: "2026-10-10T12:05:00Z",
        deposits: [
          {
            txHash: `0x${"3".repeat(64)}`,
            logIndex: 0,
            from: "0x8ba1f109551bd432803012645ac136ddd64dba72",
            amount: "1250000000",
            blockNumber: 100,
            blockTime: "2026-10-10T12:04:00Z",
            status: "confirmed",
            late: false,
            paid: "1250000000",
            blocksLeft: 0,
            blocksTotal: 0,
            secondsLeft: 0,
          },
        ],
        crossChain: kept(quote("1263000000"), {
          status,
          depositSeenAt: "2026-10-10T12:01:00Z",
          convertedAt: status === "SUCCESS" ? "2026-10-10T12:03:00Z" : null,
        }),
      });
      await page.goto(`/pay/${PAY}`);
      await expect(page.getByRole("link", { name: "Download receipt" })).toBeVisible();
      await expect(page.getByText("Paid with")).toHaveCount(named ? 1 : 0);
      await expect(page.getByText("1,263.00 USDT on Tron")).toHaveCount(named ? 1 : 0);
    });

  test("a reload shows a kept quote only against the refund address this tab typed", async ({
    page,
  }) => {
    await page.clock.install({ time: NOW });
    await page.addInitScript(([key, value]) => sessionStorage.setItem(key, value), [
      `forwend:cross:${LIVE.invoiceId}`,
      JSON.stringify({ assetId: TRON_USDT, refundTo: REFUND }),
    ] as const);
    // This tab asked with REFUND: the kept quote shows again after a reload, checked again.
    await mockInvoice(page, { ...LIVE, crossChain: kept(quote("1263000000"), {}) });
    await page.goto(`/pay/${PAY}`);
    await expect(page.getByText(DEPOSIT_ADDRESS)).toBeVisible();

    // The api keeps a quote 1Click signed with another refund address: it never shows.
    const attacker = "TAttackerRefund11111111111111111111";
    const theirs = signedQuote({
      recipient: BASE_RECEIVE,
      amount: "1250000000",
      amountIn: "1263000000",
      originAsset: TRON_USDT,
      refundTo: attacker,
      depositAddress: DEPOSIT_ADDRESS,
    });
    await page.unroute("**/api/v1/invoices/*");
    await mockInvoice(page, {
      ...LIVE,
      crossChain: kept(quote("1263000000"), { refundTo: attacker, signed: theirs }),
    });
    await page.reload();
    await expect(
      page.getByRole("alert").filter({ hasText: "We could not check this address" }),
    ).toBeVisible();
    await expect(page.getByText(DEPOSIT_ADDRESS)).toHaveCount(0);
  });

  test("a quote this tab kept still shows after the payee turned new quotes off (R-240)", async ({
    page,
  }) => {
    await page.clock.install({ time: NOW });
    await page.addInitScript(([key, value]) => sessionStorage.setItem(key, value), [
      `forwend:cross:${LIVE.invoiceId}`,
      JSON.stringify({ assetId: TRON_USDT, refundTo: REFUND }),
    ] as const);
    await mockInvoice(page, {
      ...LIVE,
      crossChainOn: false,
      crossChain: kept(quote("1263000000"), {}),
    });
    await page.goto(`/pay/${PAY}`);
    await expect(page.getByText(DEPOSIT_ADDRESS)).toBeVisible();
    // Once its price ends, a new one is refused: the payer is told to pay directly, not to try again.
    await page.route(`**/api/v1/invoices/${PAY}/crosschain/quotes`, (route) =>
      route.fulfill({
        status: 422,
        json: { error: { code: "crosschain_unavailable", message: "the payee turned it off" } },
      }),
    );
    await page.clock.runFor(15 * 60_000);
    await page.getByRole("button", { name: "Get new price" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "isn't available for this payment now" }),
    ).toBeVisible();
    // Back to the Base option, the switch offers no new quote. An address showed: leaving takes two presses (R-68).
    await page.getByRole("button", { name: "Pay directly instead" }).click();
    await expect(page.getByText(DEPOSIT_ADDRESS)).toBeVisible();
    await page.getByRole("button", { name: "Confirm change" }).click();
    await expect(page.getByRole("button", { name: "Pay with another token" })).toHaveCount(0);
  });

  test("a new tab doesn't open a kept quote once the payee turned new quotes off (R-240)", async ({
    page,
  }) => {
    await page.clock.install({ time: NOW });
    await mockInvoice(page, {
      ...LIVE,
      crossChainOn: false,
      crossChain: kept(quote("1263000000"), {}),
    });
    await page.goto(`/pay/${PAY}`);
    await expect(page.getByRole("button", { name: "Show address" })).toBeVisible();
    // The other-token box stays shut: it would ask for a price this tab can't get.
    await expect(page.getByRole("button", { name: "Pay directly instead" })).toHaveCount(0);
    await expect(page.getByText(DEPOSIT_ADDRESS)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pay with another token" })).toHaveCount(0);
  });

  test("a reload shows no kept quote for another token than this tab asked for", async ({
    page,
  }) => {
    await page.clock.install({ time: NOW });
    await page.addInitScript(([key, value]) => sessionStorage.setItem(key, value), [
      `forwend:cross:${LIVE.invoiceId}`,
      JSON.stringify({ assetId: "nep141:eth.omft.near", refundTo: REFUND }),
    ] as const);
    await mockInvoice(page, { ...LIVE, crossChain: kept(quote("1263000000"), {}) });
    await routeCrossChain(page, [quote("1263000000")]);
    await page.goto(`/pay/${PAY}`);
    await expect(page.getByLabel("Refund address on Tron")).toBeVisible();
    await expect(page.getByText(DEPOSIT_ADDRESS)).toHaveCount(0);
  });

  test("a new tab asks for the refund address before it shows a kept quote", async ({ page }) => {
    await page.clock.install({ time: NOW });
    await mockInvoice(page, { ...LIVE, crossChain: kept(quote("1263000000"), {}) });
    await routeCrossChain(page, [quote("1263000000")]);
    await page.goto(`/pay/${PAY}`);
    await expect(page.getByLabel("Refund address on Tron")).toHaveValue("");
    await expect(page.getByText(DEPOSIT_ADDRESS)).toHaveCount(0);
    await page.getByLabel("Refund address on Tron").fill(REFUND);
    await page.getByRole("button", { name: "Show address" }).click();
    await expect(page.getByText(DEPOSIT_ADDRESS)).toBeVisible();
  });
});

/** The invoice read's crossChain for quote q, as the api keeps it (R-235). */
function kept(q: ReturnType<typeof quote>, change: Record<string, unknown>) {
  return {
    provider: "near_intents",
    quoteId: q.quoteId,
    assetId: TRON_USDT,
    blockchain: "tron",
    symbol: "USDT",
    decimals: 6,
    depositAddress: q.depositAddress,
    refundTo: REFUND,
    amountIn: q.amountIn,
    minAmountIn: q.minAmountIn,
    amountOut: q.amountOut,
    status: "PENDING_DEPOSIT",
    deposited: "1263000000",
    delivered: null,
    refunded: null,
    refundReason: null,
    originTxs: [],
    destinationTxs: [],
    shownUntil: q.shownUntil,
    deadline: q.deadline,
    createdAt: q.createdAt,
    depositSeenAt: null,
    convertedAt: null,
    signed: q.signed,
    ...change,
  };
}
