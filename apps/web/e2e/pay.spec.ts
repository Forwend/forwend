import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { readPayPage } from "../scripts/canary-pay-page";
import { ID, MAIN_OPTION, mockInvoice, NOW, OPEN, PAY, RECEIVE } from "./pay-invoice";
import { blockingViolations } from "./privy/axe";
import { API_PORT, PUBLIC_URL, SUPPORT_EMAIL } from "./servers";
import { sidewaysScroll } from "./sideways";

// A second option of a payer-chooses invoice (R-56): USDC on Arbitrum Sepolia, its id derived from ID as the API does
// (keccak256(abi.encode(ID, 421614, token))) and the address predict gives for the same terms with that id.
const OPTION_ID = "0x285391c5b8b001b41a459f4011b40661d4c83c871d3f0d7881682bbced83a1c1";
const OPTION_RECEIVE = "0x1109f4fabb1748c2ce1858b2aaf8442523cfeeb0";
const POLL_MS = 15_000;

const CHOOSING = {
  ...OPEN,
  optionCount: 2,
  options: [
    MAIN_OPTION,
    {
      ...MAIN_OPTION,
      optionId: OPTION_ID,
      chainId: 421614,
      network: "arbitrum-sepolia",
      token: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
      receiveAddress: OPTION_RECEIVE,
    },
  ],
};
const SENDER = "0x8ba1f109551bd432803012645ac136ddd64dba72";
const DEPOSIT = {
  txHash: `0x${"3".repeat(64)}`,
  logIndex: 0,
  from: SENDER,
  amount: "1250000000",
  blockNumber: 100,
  blockTime: "2026-10-10T12:04:00Z",
  status: "detected",
  late: false,
  paid: null as string | null,
  blocksLeft: 12,
  blocksTotal: 12,
  secondsLeft: 150,
};
const DETECTED = { ...OPEN, paymentStatus: "detected", confirming: true, deposits: [DEPOSIT] };
const CONFIRMING = {
  ...DETECTED,
  deposits: [{ ...DEPOSIT, blocksLeft: 6, secondsLeft: 75 }],
};
const CONFIRMED = [
  {
    ...DEPOSIT,
    status: "confirmed",
    paid: "1250000000",
    blocksLeft: 0,
    blocksTotal: 0,
    secondsLeft: 0,
  },
];
const PAID = {
  ...OPEN,
  paymentStatus: "paid",
  settlementStatus: "pending",
  paidAt: "2026-10-10T12:05:00Z",
  deposits: CONFIRMED,
};
const SETTLED = {
  ...PAID,
  settlementStatus: "settled",
  settlementTxHash: `0x${"4".repeat(64)}`,
  settledAt: "2026-10-10T12:20:00Z",
};

async function openPay(page: Page, ...bodies: object[]) {
  await page.clock.install({ time: NOW });
  await mockInvoice(page, ...bodies);
  await page.goto(`/pay/${PAY}`);
}

const showAddress = (page: Page) => page.getByRole("button", { name: "Show address" });
const status = (page: Page) => page.getByRole("status").filter({ hasText: /./ }).first();
const pdfPath = (file: string) => `/api/v1/invoices/${PAY}/${file}`;
const PARTIAL = {
  ...OPEN,
  paymentStatus: "partially_paid",
  deposits: [
    {
      ...DEPOSIT,
      amount: "250000000",
      status: "confirmed",
      paid: "250000000",
      blocksLeft: 0,
      blocksTotal: 0,
      secondsLeft: 0,
    },
  ],
};
const CLOSED = { ...OPEN, paymentStatus: "expired" };
const CANCELED = { ...OPEN, paymentStatus: "canceled", canceledAt: "2026-10-10T10:05:00Z" };

// R-68
test.describe("pay page", () => {
  test("shows who asks and the amount, then the address once the payer asks for it", async ({
    page,
  }) => {
    const scripts: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "script") scripts.push(r.url());
    });
    await openPay(page, OPEN);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alice Design GmbH");
    await expect(page.getByText("Invoice INV-0001", { exact: true })).toBeVisible();
    await expect(page.getByText("Logo design", { exact: true })).toBeVisible();
    // R-90
    await expect(page.getByText("Reference PO-4500012345", { exact: true })).toBeVisible();
    // R-93
    await expect(
      page.getByText("Agreed value €1,150.00 on Oct 9, 2026", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("[data-money]")).toHaveText("1,250.00 USDC");
    await expect(page.getByText("on Base Sepolia", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download invoice PDF" })).toHaveAttribute(
      "href",
      pdfPath("invoice.pdf"),
    );
    // R-68
    await expect(page.getByText("Waiting for payment…")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Check status" })).toHaveCount(0);
    await expect(page.getByText(/test network/)).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Payment progress" })).toHaveCount(0);
    const scam = page.getByText(
      "Forwend never asks you to pay a different address or a fee this page doesn't show.",
    );
    await expect(scam).toBeHidden();
    await page.getByRole("contentinfo").getByRole("button", { name: "Need help?" }).click();
    const help = page.getByRole("dialog", { name: "Need help?" });
    await expect(
      help.getByText(
        "Forwend never asks you to pay a different address or a fee this page doesn't show.",
      ),
    ).toBeVisible();
    await expect(help.getByText(`You are on ${new URL(PUBLIC_URL).host}.`)).toBeVisible();
    await expect(help.getByRole("heading", { level: 3 })).toHaveText([
      "Check this page",
      "Sent too much, too late or after it closed?",
      "Sent on the wrong network or token?",
    ]);
    await expect(help.getByText(/we can't promise it/)).toBeVisible();
    await expect(
      help.getByText(/under 0\.10 USD aren't returned\. .+may never come back/),
    ).toBeVisible();
    // PLAN 11.10: support returns held money, so the message carries the pay link it needs.
    const mail = new URL(
      (await help.getByRole("link", { name: "Email support" }).getAttribute("href")) ?? "",
    );
    expect(`${mail.protocol}${mail.pathname}`).toBe(`mailto:${SUPPORT_EMAIL}`);
    expect(mail.searchParams.get("body")).toContain(`Pay link: ${PUBLIC_URL}/pay/${PAY}`);
    await expect(help.getByText(`Or write to ${SUPPORT_EMAIL}`)).toBeVisible();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await help.getByRole("button", { name: "Copy email address" }).click();
    await expect(help.getByRole("button", { name: "Email address copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SUPPORT_EMAIL);
    expect(await blockingViolations(page)).toEqual([]);
    // Nobody is called "the sender": the payer could read it as themselves.
    await expect(page.getByText(/\bsender\b/)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();

    await expect(page.getByText(RECEIVE)).toHaveCount(0);
    await expect(page.getByRole("img", { name: /QR code/ })).toHaveCount(0);
    await showAddress(page).click();
    await expect(page.getByRole("heading", { name: "Send USDC on Base Sepolia to" })).toBeFocused();
    await expect(page.getByText(RECEIVE)).toBeVisible();
    await expect(page.getByRole("img", { name: "QR code of the address to pay" })).toBeVisible();
    await expect(page.getByRole("note")).toHaveText("Send only USDC on Base Sepolia.");
    // R-78
    const shown = page.locator("[data-address]");
    await expect(shown).toHaveText(RECEIVE);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await shown.click();
    await page.keyboard.press("ControlOrMeta+C");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(RECEIVE);
    await expect(page.getByRole("link", { name: /0x036c.*cf7e/ })).toHaveAttribute(
      "href",
      "https://sepolia.basescan.org/address/0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    );
    await expect(
      page.getByText(/^Paying from an exchange\? Withdraw on Base Sepolia,/),
    ).toBeVisible();
    await expect(status(page)).toHaveText("Waiting for payment…");
    await expect(page.getByRole("button", { name: "Check status" })).toBeVisible();
    await page.reload();
    await expect(page.getByText(RECEIVE)).toBeVisible();

    expect(scripts.length).toBeGreaterThan(0);
    for (const url of scripts) expect(new URL(url).origin, url).toBe(new URL(PUBLIC_URL).origin);
  });

  // R-228: the client pays the fees on top of the price; the address is predict's for terms with them (R-226).
  test("when the client pays the fees, the amount says the price and the fees, and the address carries them", async ({
    page,
  }) => {
    const receive = "0xf1d8352d510b68a825152dca4582582aeb9486b3";
    const fees = {
      amount: "1250050000",
      networkFee: "50000",
      platformFee: "0",
      feesPaidBy: "client",
      receiveAddress: receive,
    };
    await openPay(page, {
      ...OPEN,
      ...fees,
      factory: "0xe917ce63865f8cf91a0038136e496b25ece2a54e",
      options: [{ ...MAIN_OPTION, ...fees }],
    });
    await expect(page.locator("[data-money]")).toHaveText("1,250.05 USDC");
    await expect(
      page.getByText("1,250.00 USDC plus 0.05 USDC network fee", { exact: true }),
    ).toBeVisible();
    await showAddress(page).click();
    await expect(page.getByText(receive, { exact: true })).toBeVisible();
  });

  // R-228: every option carries the same fees (D-122), so they read in USD before a token is picked.
  test("before a token is picked, the amount says the price and the fees in USD", async ({
    page,
  }) => {
    const fees = {
      amount: "1250050000",
      networkFee: "50000",
      platformFee: "0",
      feesPaidBy: "client",
    };
    // Before a pick only the shown option's terms are checked: the fee test's predicted address for them.
    const receiveAddress = "0xf1d8352d510b68a825152dca4582582aeb9486b3";
    await openPay(page, {
      ...CHOOSING,
      ...fees,
      factory: "0xe917ce63865f8cf91a0038136e496b25ece2a54e",
      receiveAddress,
      options: [
        { ...MAIN_OPTION, ...fees, receiveAddress },
        { ...CHOOSING.options[1], ...fees },
      ],
    });
    await expect(page.locator("[data-money]")).toHaveText("1,250.05 USD");
    await expect(
      page.getByText("1,250.00 USD plus 0.05 USD network fee", { exact: true }),
    ).toBeVisible();
  });

  test("a payment-link invoice before its first deposit shows no number (R-141)", async ({
    page,
  }) => {
    await openPay(page, { ...OPEN, number: null });
    await expect(page.getByText("Invoice", { exact: true })).toBeVisible();
    await expect(page.getByText(/INV-/)).toHaveCount(0);
    await expect(page.locator("[data-money]")).toHaveText("1,250.00 USDC");
  });

  test("checkout shows purchase items and a receipt without an invoice document", async ({
    page,
  }) => {
    const checkout = {
      ...OPEN,
      purpose: "checkout",
      documentKind: "none",
      number: null,
      dueDate: null,
      agreedValue: null,
      lines: [
        { description: "Coffee", quantity: "2.00", unitPrice: "625000000", amount: "1250000000" },
      ],
    };
    await openPay(page, checkout);
    await expect(page.getByText("Checkout", { exact: true })).toBeVisible();
    await expect(page.getByText("Coffee", { exact: true })).toBeVisible();
    await expect(page.getByText("2 × 625.00 USD", { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Items", exact: true })
        .getByText("1,250.00 USD", { exact: true }),
    ).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Download invoice PDF" })).toHaveCount(0);
    await expect(page.getByText(/INV-/)).toHaveCount(0);
    await showAddress(page).click();
    await expect(page.getByText(RECEIVE, { exact: true })).toBeVisible();
    await mockInvoice(page, {
      ...PAID,
      ...checkout,
      paymentStatus: "paid",
      paidAt: PAID.paidAt,
      deposits: PAID.deposits,
    });
    await page.clock.fastForward(POLL_MS);
    await expect(page.getByRole("link", { name: "Download receipt" })).toHaveAttribute(
      "href",
      pdfPath("receipt.pdf"),
    );
    await expect(page.getByRole("link", { name: "Download invoice PDF" })).toHaveCount(0);
  });

  test("checkout items keep their base units when the customer picks another network", async ({
    page,
  }) => {
    await openPay(page, {
      ...CHOOSING,
      purpose: "checkout",
      documentKind: "none",
      number: null,
      options: CHOOSING.options.map((option) => ({ ...option, decimals: 18 })),
      lines: [
        { description: "Coffee", quantity: "2.00", unitPrice: "625000000", amount: "1250000000" },
      ],
    });
    await expect(
      page
        .getByRole("region", { name: "Items", exact: true })
        .getByText("1,250.00 USD", { exact: true }),
    ).toHaveCount(2);
    await page.getByRole("combobox", { name: "Network" }).click();
    await page.getByRole("option", { name: "Arbitrum Sepolia" }).click();
    await showAddress(page).click();
    await expect(page.getByText(OPTION_RECEIVE, { exact: true })).toBeVisible();
    await expect(page.getByText("2 × 625.00 USD", { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Items", exact: true })
        .getByText("1,250.00 USD", { exact: true }),
    ).toHaveCount(2);
  });

  test("testnet is marked in the checkout header and live payments are not", async ({ page }) => {
    const amounts = {
      receiver: "0",
      payable: "0",
      held: "0",
      settled: "0",
      refunded: "0",
      observedRefunded: "0",
      lastReturnTxHash: null,
      unreconciled: true,
      hasPolicyException: false,
      reconciliationStatus: "pending",
    };
    await openPay(page, { ...OPEN, amounts, options: [{ ...MAIN_OPTION, amounts }] });
    await showAddress(page).click();
    await expect(page.getByText(RECEIVE)).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await sidewaysScroll(page)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `../../docs/runs/f336-checkout-${width}.png`, fullPage: true });
    }
    const note = page.getByText("Testnet", { exact: true });
    await expect(note).toBeVisible();
    await mockInvoice(page, { ...OPEN, livemode: true });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alice Design GmbH");
    await expect(note).toHaveCount(0);
  });

  // R-55
  test("Check status says once what it found, and a reload shows when the next check is allowed", async ({
    page,
  }) => {
    // A phone, where Check status sits low on the screen.
    await page.setViewportSize({ width: 390, height: 664 });
    await openPay(page, OPEN);
    await showAddress(page).click();
    let calls = 0;
    await page.route(`**/api/v1/invoices/${PAY}/recheck`, (route) => {
      calls++;
      return route.fulfill({
        json: {
          onChain: "1250000000",
          recorded: "0",
          rescanning: true,
          nextCheckAt: new Date(NOW.getTime() + 300_000).toISOString(),
          unreadable: [],
        },
      });
    });
    const check = page.getByRole("button", { name: "Check status" });
    await check.click();
    // The status line agrees with what the check found: the money is there, so it no longer waits for it.
    await expect(page.getByRole("status").filter({ hasText: "Payment found" })).toBeVisible();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Found 1,250.00 USDC. Recording it now. Don't pay again." }),
    ).toBeVisible();
    await expect(page.getByText("Waiting for payment…")).toHaveCount(0);
    // Found money needs no other check; focus moves from the button that went to the address's heading.
    await expect(check).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /^Send USDC on/ })).toBeFocused();
    // Moving focus scrolls nothing: the found line stays on screen.
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Found 1,250.00 USDC. Recording it now. Don't pay again." }),
    ).toBeInViewport({ ratio: 1 });
    await expect(page.getByText(/Next check in/)).toHaveCount(0);
    expect(calls).toBe(1);
    await mockInvoice(page, {
      ...OPEN,
      nextCheckAt: new Date(NOW.getTime() + 240_000).toISOString(),
    });
    await page.reload();
    await expect(check).toBeDisabled();
    await expect(page.getByText("Next check in 4 min", { exact: true })).toBeVisible();
  });

  test("Check status stays beside the status once a check answers, with the answer under them", async ({
    page,
  }) => {
    await openPay(page, OPEN);
    await showAddress(page).click();
    await page.route(`**/api/v1/invoices/${PAY}/recheck`, (route) =>
      route.fulfill({
        json: {
          onChain: "0",
          recorded: "0",
          rescanning: false,
          nextCheckAt: new Date(NOW.getTime() + 300_000).toISOString(),
          unreadable: [421614],
        },
      }),
    );
    const waiting = page.getByRole("status").filter({ hasText: "Waiting for payment…" });
    const check = page.getByRole("button", { name: "Check status" });
    const answer = page.getByText(/· Next check in 5 min$/);
    await check.click();
    // A network that did not answer is named beside what the check saw.
    await expect(page.getByRole("status").filter({ hasText: /did not answer/ })).toHaveText(
      "Nothing on Base Sepolia yet. · Arbitrum Sepolia did not answer.",
    );
    for (const width of [1440, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await check.click();
      await expect(answer).toBeVisible();
      const [row, button, below] = await Promise.all([
        waiting.boundingBox(),
        check.boundingBox(),
        answer.boundingBox(),
      ]);
      const middle = (box: typeof row) => (box ? box.y + box.height / 2 : 0);
      expect(Math.abs(middle(row) - middle(button))).toBeLessThan(4);
      expect(below && button && below.y >= button.y + button.height).toBe(true);
    }
  });

  test("Check status asked too soon rests instead of reporting a network failure", async ({
    page,
  }) => {
    await openPay(page, OPEN);
    await showAddress(page).click();
    await page.route(`**/api/v1/invoices/${PAY}/recheck`, (route) =>
      route.fulfill({
        status: 429,
        headers: { "Retry-After": "120" },
        json: { error: { code: "rate_limited", message: "checked recently" } },
      }),
    );
    const check = page.getByRole("button", { name: "Check status" });
    await check.click();
    await expect(page.getByRole("status").filter({ hasText: /^Checked/ })).toHaveText(
      "Checked recently.",
    );
    await expect(check).toBeDisabled();
    await page.clock.runFor(31_000);
    await expect(check).toBeEnabled();
  });

  // R-73
  test("a page opened while a payment confirms counts the blocks already passed", async ({
    page,
  }) => {
    await openPay(page, CONFIRMING);
    await expect(status(page)).toContainText("Confirming (6/12)");
    await page.reload();
    await expect(status(page)).toContainText("Confirming (6/12)");
  });

  test("follows the payment from waiting to paid without a reload, and never shows Settled", async ({
    page,
  }) => {
    // R-125: one view for the load, none for the status refreshes after it.
    const views: string[] = [];
    await page.route("**/api/v1/invoices/*/views", (route) => {
      views.push(route.request().method());
      return route.fulfill({ status: 204 });
    });
    await openPay(page, OPEN, DETECTED, CONFIRMING, PAID, SETTLED);
    await page.evaluate(() => {
      (window as unknown as { stayed: boolean }).stayed = true;
    });
    await showAddress(page).click();
    await expect(status(page)).toHaveText("Waiting for payment…");

    // R-68: once the full amount is on its way, no address invites a second payment.
    await page.clock.runFor(POLL_MS);
    await expect(status(page)).toContainText("Confirming (0/12)");
    await expect(page.getByText(RECEIVE)).toHaveCount(0);
    await expect(page.locator("[data-status]")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Paying with" })).toBeVisible();
    const steps = page.getByRole("list", { name: "Payment progress" });
    await expect(steps.getByRole("listitem")).toHaveText([/^Detected/, /^Confirming/, /^Paid/]);
    await expect(steps.locator("[aria-current=step]")).toHaveText("Confirming");
    await expect(status(page).getByRole("button", { name: "About 3 min left" })).toBeVisible();
    await expect(status(page).getByText("Confirming (0/12)", { exact: true })).toBeVisible();
    const payment = page.getByRole("region", { name: "Payment progress" }).locator("ul > li");
    await expect(payment).toContainText("1,250.00 USDC");
    await expect(payment).toContainText("0x3333…3333");
    await expect(payment.getByRole("link", { name: /Basescan/ })).toHaveAttribute(
      "href",
      `https://sepolia.basescan.org/tx/${DEPOSIT.txHash}`,
    );

    await page.clock.runFor(POLL_MS);
    await expect(status(page)).toContainText("Confirming (6/12)");

    await page.clock.runFor(POLL_MS);
    await expect(page.getByRole("status").filter({ hasText: /^Paid$/ })).toBeVisible();
    const explorer = page.getByRole("link", { name: "View transaction" });
    await expect(explorer).toHaveAttribute(
      "href",
      `https://sepolia.basescan.org/tx/${DEPOSIT.txHash}`,
    );
    await expect(explorer).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("link", { name: "Download receipt" })).toHaveAttribute(
      "href",
      pdfPath("receipt.pdf"),
    );

    // Settled is the sender's business: the payer still sees Paid, with no settlement details.
    await page.clock.runFor(POLL_MS);
    await expect(page.getByRole("status").filter({ hasText: /^Paid$/ })).toBeVisible();
    await expect(page.getByText(/[Ss]ettle/)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(
      true,
    );
    expect(views).toEqual(["POST"]);
  });

  test("recorded returns stay visible and unresolved records never invite another payment", async ({
    page,
  }) => {
    const amounts = {
      receiver: "0",
      payable: "0",
      held: "0",
      settled: "0",
      refunded: "1250000000",
      observedRefunded: "1250000000",
      lastReturnTxHash: `0x${"5".repeat(64)}`,
      unreconciled: false,
      hasPolicyException: true,
    };
    await openPay(page, { ...PAID, amounts, options: [{ ...MAIN_OPTION, amounts }] });
    await expect(page.getByRole("status").filter({ hasText: /^Paid$/ })).toBeVisible();
    await expect(page.getByText(/^Recorded returns:/)).toContainText("1,250.00 USDC");
    await expect(
      page.getByText("We could not verify this payment. Contact support before sending more.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Basescan/ }).last()).toHaveAttribute(
      "href",
      `https://sepolia.basescan.org/tx/${amounts.lastReturnTxHash}`,
    );
    await expect(showAddress(page)).toHaveCount(0);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await sidewaysScroll(page)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `../../docs/runs/f329-return-${width}.png`, fullPage: true });
    }
    await mockInvoice(page, {
      ...OPEN,
      amounts: { ...amounts, unreconciled: true },
      options: [{ ...MAIN_OPTION, amounts: { ...amounts, unreconciled: true } }],
    });
    await page.reload();
    await expect(
      page.getByText("Payment could not be verified. Contact the merchant before sending more.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(showAddress(page)).toHaveCount(0);
    await expect(page.getByText(RECEIVE)).toHaveCount(0);
  });

  test("a closed payment option leaves another option available", async ({ page }) => {
    const mixed = {
      ...CHOOSING,
      options: CHOOSING.options.map((option, index) => ({
        ...option,
        closesAt: index === 0 ? "2026-10-09T12:00:00Z" : OPEN.closesAt,
      })),
    };
    await page.clock.install({ time: NOW });
    await mockInvoice(page, mixed);
    await page.goto(`/pay/${PAY}?option=${ID}`);
    await expect(showAddress(page)).toHaveCount(0);
    // Its option closed, but another can be picked: the pickers stay, with no closed state beside them.
    await expect(page.getByRole("combobox", { name: "Network" })).toBeVisible();
    await expect(page.getByText("Checkout closed", { exact: true })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Network" }).click();
    await page.getByRole("option", { name: "Arbitrum Sepolia" }).click();
    await showAddress(page).click();
    await expect(page.getByText(OPTION_RECEIVE)).toBeVisible();
  });

  // R-82
  test("takes an optional address for the receipt", async ({ page }) => {
    const sent: unknown[] = [];
    let answer = 200;
    await page.route("**/api/v1/invoices/*/payer-email", async (route) => {
      sent.push(route.request().postDataJSON());
      await new Promise((resolve) => setTimeout(resolve, 300)); // a slow answer: a second press must not send again
      return answer === 200
        ? route.fulfill({ json: { email: "payer@example.com" } })
        : route.fulfill({ status: answer, json: { error: { code: "x", message: "x" } } });
    });
    await openPay(page, OPEN);
    await expect(page.getByRole("button", { name: "Email me a receipt" })).toHaveCount(0);
    await mockInvoice(page, DETECTED);
    await page.reload();
    await page.getByRole("button", { name: "Email me a receipt" }).click();
    const field = page.getByLabel("Email me the receipt (optional)");
    await expect(field).toBeFocused();
    await expect(
      page.getByText("Used for this receipt only. Nothing else is sent to it."),
    ).toBeVisible();
    await field.fill(" Payer@Example.com ");
    await field.press("Enter");
    await field.press("Enter");
    const saved = page.getByText("We will email the receipt to payer@example.com once it is paid.");
    await expect(saved).toBeVisible();
    await expect(page.getByText("Receipt saved")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
    expect(sent).toEqual([{ email: "Payer@Example.com" }]); // an email field trims; the server lowercases

    await page.getByRole("button", { name: "Use another address" }).click();
    await expect(field).toBeFocused();
    answer = 422;
    await field.fill("not an address");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Enter an address like name@example.com.")).toBeVisible();

    answer = 409;
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.route("**/api/v1/invoices/*/payer-email", (route) =>
      route.fulfill({ status: 409, json: { error: { code: "receipt_sent", message: "x" } } }),
    );
    await mockInvoice(page, PAID);
    await page.reload();
    await page.getByRole("button", { name: "Email me a receipt" }).click();
    await page.getByLabel("Email me the receipt (optional)").fill("payer@example.com");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("The receipt was already sent.")).toBeVisible();
  });

  test("a failed load says so in the middle of the page, and Try again loads the invoice", async ({
    page,
  }) => {
    let call = 0;
    // OPEN's checkout closes at a fixed time, so the page must read it at NOW, as openPay does.
    await page.clock.install({ time: NOW });
    await page.route("**/api/v1/invoices/*", (route) =>
      call++ === 0 ? route.fulfill({ status: 500, json: {} }) : route.fulfill({ json: OPEN }),
    );
    await page.goto(`/pay/${PAY}`);
    const alert = page.getByRole("alert").filter({ hasText: "We could not load this payment" });
    await expect(alert).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const box = await alert.boundingBox();
      // The page's middle: its root's own width, which leaves out the scrollbar's reserved room.
      const middle = await page.evaluate(
        () => document.documentElement.getBoundingClientRect().width / 2,
      );
      expect(box && Math.abs(box.x + box.width / 2 - middle)).toBeLessThan(2);
      expect(box?.y).toBeGreaterThan(900 / 6);
    }
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(showAddress(page)).toBeVisible();
  });

  test("a failed refresh keeps the last read under one line across the page's top (R-194)", async ({
    page,
  }) => {
    let fail = false;
    let hold: Promise<void> | null = null;
    await page.clock.install({ time: NOW });
    await page.route("**/api/v1/invoices/*", async (route) => {
      await hold;
      return fail ? route.fulfill({ status: 500, json: {} }) : route.fulfill({ json: OPEN });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/pay/${PAY}`);
    const amount = page.locator("#pay-amount");
    await expect(amount).toBeVisible();
    const before = await amount.boundingBox();
    fail = true;
    await page.clock.runFor(POLL_MS);
    const notice = page.getByRole("alert").filter({ hasText: "Can't reach the server. Retrying…" });
    await expect(notice).toBeVisible();
    await expect(showAddress(page)).toBeVisible();
    const root = await page.evaluate(() => document.documentElement.getBoundingClientRect().width);
    const wide = await notice.boundingBox();
    expect(wide?.x).toBe(0);
    expect(wide?.y).toBe(0);
    expect(wide && Math.abs(wide.width - root)).toBeLessThan(2);
    // It pushes the page down by its own height, with no gap under it.
    const after = await amount.boundingBox();
    expect(before && after && wide && Math.abs(after.y - before.y - wide.height)).toBeLessThan(2);
    await page.setViewportSize({ width: 390, height: 900 });
    const narrow = await notice.boundingBox();
    const below = await amount.boundingBox();
    expect(narrow && below && narrow.y + narrow.height).toBeLessThan(below?.y ?? 0);
    // It retries on its own, so it offers no button. While the next read is in flight the strip stays, so the page
    // doesn't jump; it goes once a read works.
    await expect(notice.getByRole("button")).toHaveCount(0);
    let release = () => {};
    hold = new Promise((resolve) => (release = resolve));
    fail = false;
    await page.clock.runFor(POLL_MS);
    await expect(notice).toBeVisible();
    release();
    await expect(notice).toHaveCount(0);
  });

  test("a canceled invoice with several tokens shows that it is closed, with no network or token to pick", async ({
    page,
  }) => {
    await openPay(page, { ...CHOOSING, paymentStatus: "canceled" });
    await expect(status(page)).toContainText("Payment closed");
    await expect(status(page)).toContainText(
      "Alice Design GmbH closed this payment. Do not send money.",
    );
    await expect(page.getByRole("combobox", { name: "Network" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Token" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Pay with" })).toHaveCount(0);
    await page.locator("[data-money]").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: "../../docs/runs/f401-canceled-choosing-1440.png" });
  });

  test("a payer watching hears the payment close: the status stays and says so", async ({
    page,
  }) => {
    await openPay(page, OPEN, CANCELED);
    await showAddress(page).click();
    const region = await page
      .getByRole("status")
      .filter({ hasText: "Waiting for payment…" })
      .elementHandle();
    await page.clock.runFor(POLL_MS);
    await expect(page.getByText("Payment closed", { exact: true })).toBeVisible();
    expect(await region?.evaluate((el) => el.isConnected && el.textContent)).toContain(
      "Alice Design GmbH closed this payment. Do not send money.",
    );
  });

  test("the loading page puts its placeholders where the payee and the pay panel arrive", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.clock.install({ time: NOW });
    await page.route("**/api/v1/invoices/*", async (route) => {
      await held;
      return route.fulfill({ json: OPEN });
    });
    await page.goto(`/pay/${PAY}`);
    const row = (selector: string) => page.locator(selector).first().boundingBox();
    await expect(page.locator("[data-skeleton]").first()).toBeAttached();
    const payeeWaiting = await row("main [aria-busy] [data-skeleton]");
    const panelWaiting = await row("main .fw-panel");
    release();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alice Design GmbH");
    const payee = await row("section[aria-labelledby='pay-amount'] > div");
    const panel = await row("main .fw-panel");
    expect(Math.abs((payeeWaiting?.y ?? 0) - (payee?.y ?? 0))).toBeLessThanOrEqual(2);
    expect(Math.abs((panelWaiting?.x ?? 0) - (panel?.x ?? 0))).toBeLessThanOrEqual(2);
    expect(Math.abs((panelWaiting?.width ?? 0) - (panel?.width ?? 0))).toBeLessThanOrEqual(2);
  });

  // R-79
  test("tells the payer a canceled invoice takes no money", async ({ page }) => {
    await openPay(page, CANCELED);
    await expect(status(page)).toContainText(
      "Alice Design GmbH closed this payment. Do not send money.",
    );
    await expect(showAddress(page)).toHaveCount(0);
    await expect(page.getByText("Amount", { exact: true })).toBeVisible();

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await mockInvoice(page, { ...CANCELED, deposits: [{ ...DEPOSIT, amount: "250000000" }] });
    await page.reload();
    await expect(page.getByText("250.00 USDC held for you")).toBeVisible();
    await expect(showAddress(page)).toHaveCount(0);
  });

  // PLAN 11.10: held money comes back through support; the page never sends the payer to the payee for it.
  test("every held payment gets one short line, and How to get it back opens Need help", async ({
    context,
  }) => {
    const confirmed = {
      ...DEPOSIT,
      status: "confirmed",
      blocksLeft: 0,
      blocksTotal: 0,
      secondsLeft: 0,
    };
    const held: [object, string | RegExp][] = [
      [
        { ...PAID, deposits: [{ ...confirmed, amount: "1300000000", paid: "1250000000" }] },
        "Overpaid by 50.00 USDC",
      ],
      [
        { ...CLOSED, deposits: [{ ...confirmed, late: true, amount: "100000000" }] },
        "100.00 USDC arrived after the checkout closed",
      ],
      [
        { ...PARTIAL, paymentStatus: "expired_partially_paid" },
        "Closed before the full amount arrived. 250.00 USDC is held for you.",
      ],
      [
        { ...CANCELED, deposits: [{ ...DEPOSIT, amount: "250000000" }] },
        "250.00 USDC held for you",
      ],
      [
        {
          ...CHOOSING,
          optionLocked: true,
          options: [
            MAIN_OPTION,
            { ...CHOOSING.options[1], deposits: [{ ...confirmed, amount: "5000000" }] },
          ],
        },
        /^5\.00 USDC on .+ went to another option$/,
      ],
    ];
    for (const [invoice, line] of held) {
      const page = await context.newPage();
      await openPay(page, invoice);
      await expect(page.getByText(line)).toBeVisible();
      await expect(
        page.getByText(/ask (the recipient|Alice Design GmbH) to get it back/i),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "How to get it back" }).click();
      await expect(
        page
          .getByRole("dialog", { name: "Need help?" })
          .getByRole("heading", { name: "Sent too much, too late or after it closed?" }),
      ).toBeVisible();
      await page.close();
    }
  });

  // PLAN 11.10.3: once support returned the extra, the payer sees the return and no held line.
  test("an overpayment returned to the payer is no longer shown as held", async ({ page }) => {
    const confirmed = {
      ...DEPOSIT,
      status: "confirmed",
      blocksLeft: 0,
      blocksTotal: 0,
      secondsLeft: 0,
    };
    const amounts = {
      reconciliationStatus: "verified",
      receiver: "1250000000",
      payable: "1250000000",
      held: "0",
      settled: "0",
      refunded: "50000000",
      observedRefunded: "50000000",
      lastReturnTxHash: `0x${"8".repeat(64)}`,
      unreconciled: false,
      hasPolicyException: false,
    };
    const returned = {
      ...PAID,
      deposits: [{ ...confirmed, amount: "1300000000", paid: "1250000000" }],
    };
    await openPay(page, {
      ...returned,
      amounts,
      options: [{ ...MAIN_OPTION, amounts, deposits: returned.deposits }],
    });
    await expect(page.getByText("Recorded returns: 50.00 USDC on Base Sepolia.")).toBeVisible();
    await expect(page.getByText(/^Overpaid by/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "How to get it back" })).toHaveCount(0);
  });

  test("says what is left when partly paid, and that a closed invoice takes no more", async ({
    page,
  }) => {
    await openPay(page, PARTIAL, CLOSED);
    await expect(status(page)).toHaveText("250.00 USDC received. 1,000.00 USDC left to send.");
    await expect(page.locator("[data-money]").first()).toHaveText("1,000.00 USDC");
    await expect(showAddress(page)).toBeVisible();
    // R-77
    await expect(page.getByText(/^Closes in/)).toBeVisible();
    const partlySteps = page.getByRole("list", { name: "Payment progress" });
    await expect(partlySteps.getByText("Partially paid")).toHaveClass(/bg-warning-soft/);
    await expect(partlySteps.getByRole("listitem")).toHaveText([
      /^Detected/,
      /^Confirmed/,
      /^Partially paid/,
    ]);
    await page.clock.runFor(POLL_MS);
    await expect(status(page)).toContainText(
      "This payment is closed. Do not send money. If you already did, Need help says what to do.",
    );
    await expect(showAddress(page)).toHaveCount(0);
  });

  // R-130: past the terms' expiry, a reopened invoice takes money until its new close.
  test("a reopened invoice shows its address and time left until the new close", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-10-17T20:00:00Z") });
    await mockInvoice(page, { ...PARTIAL, closesAt: "2026-10-18T10:00:00Z" });
    await page.goto(`/pay/${PAY}`);
    await expect(status(page)).toHaveText("250.00 USDC received. 1,000.00 USDC left to send.");
    await expect(page.getByText(/^Closes in/)).toBeVisible();
    await showAddress(page).click();
    await expect(page.getByText(RECEIVE)).toBeVisible();
  });

  test("once Check status finds a payment, the payer can't change the network and token", async ({
    page,
  }) => {
    await openPay(page, CHOOSING);
    await page.getByRole("combobox", { name: "Network" }).click();
    await page.getByRole("option", { name: "Arbitrum Sepolia" }).click();
    await showAddress(page).click();
    const change = page.getByRole("button", { name: "Change network and token" });
    await expect(change).toBeVisible();
    await page.route(`**/api/v1/invoices/${PAY}/recheck`, (route) =>
      route.fulfill({
        json: {
          onChain: "1250000000",
          recorded: "0",
          rescanning: true,
          nextCheckAt: new Date(NOW.getTime() + 300_000).toISOString(),
          unreadable: [],
        },
      }),
    );
    await page.getByRole("button", { name: "Check status" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Payment found" })).toBeVisible();
    await expect(change).toHaveCount(0);
  });

  test("the canary's ?option= link asks for Show address and keeps no pick, whatever the invoice kept", async ({
    page,
  }) => {
    await page.clock.install({ time: NOW });
    await mockInvoice(page, { ...CHOOSING, pickedOptionId: OPTION_ID });
    let kept = 0;
    await page.route(`**/api/v1/invoices/${PAY}/pick`, (route) => {
      kept++;
      return route.fulfill({ status: 204 });
    });
    await page.goto(`/pay/${PAY}?option=${OPTION_ID}`);
    await expect(page.getByText(OPTION_RECEIVE)).toHaveCount(0);
    await showAddress(page).click();
    await expect(page.getByText(OPTION_RECEIVE)).toBeVisible();
    expect(kept).toBe(0);
  });

  test("the owner's preview keeps no pick on the invoice, yet a reload in the tab still shows the picked address", async ({
    page,
  }) => {
    await page.clock.install({ time: NOW });
    await mockInvoice(page, CHOOSING);
    let kept = 0;
    await page.route(`**/api/v1/invoices/${PAY}/pick`, (route) => {
      kept++;
      return route.fulfill({ status: 204 });
    });
    await page.goto(`/pay/${PAY}?preview=1`);
    await page.getByRole("combobox", { name: "Network" }).click();
    await page.getByRole("option", { name: "Arbitrum Sepolia" }).click();
    await showAddress(page).click();
    await expect(page.getByText(OPTION_RECEIVE)).toBeVisible();
    await page.reload();
    await expect(page.getByText(OPTION_RECEIVE)).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Network" })).toHaveCount(0);
    expect(kept).toBe(0);
  });

  test("lets the payer pick the network and token with selects, keeps the pick on the invoice for the next visit, and locks it once money arrives", async ({
    page,
  }) => {
    const picked = { ...CHOOSING, pickedOptionId: OPTION_ID };
    await openPay(page, CHOOSING, picked, picked, { ...picked, optionLocked: true });
    const kept: unknown[] = [];
    await page.route(`**/api/v1/invoices/${PAY}/pick`, (route) => {
      kept.push(route.request().postDataJSON());
      return route.fulfill({ status: 204 });
    });
    await expect(page.locator("[data-money]")).toHaveText("1,250.00 USD");
    await expect(showAddress(page)).toHaveCount(0);
    expect(await blockingViolations(page)).toEqual([]);

    // Arbitrum carries one token, so picking the network picks it.
    await page.getByRole("combobox", { name: "Network" }).click();
    await page.getByRole("option", { name: "Arbitrum Sepolia" }).click();
    await expect(page.getByRole("combobox", { name: "Token" })).toHaveText(/USDC/);
    await showAddress(page).click();
    await expect(page.getByText(OPTION_RECEIVE)).toBeVisible();
    // Show address keeps the pick on the invoice; the address stays the bare pay link.
    expect(kept).toEqual([{ optionId: OPTION_ID }]);
    expect(new URL(page.url()).search).toBe("");
    // R-78
    await expect(page.getByRole("note")).toHaveText(
      "Send only USDC on Arbitrum Sepolia. Native USDC, not USDC.e.",
    );
    await expect(page.getByRole("link", { name: /0x75fa.*aa4d/ })).toHaveAttribute(
      "href",
      "https://sepolia.arbiscan.io/address/0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
    );

    // The next visit, with nothing in this browser: the link opens on the kept pick and its address.
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(page.getByText(OPTION_RECEIVE)).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Network" })).toHaveCount(0);

    // Two presses, so a payer who already sent does not switch by accident.
    const change = page.getByRole("button", { name: "Change network and token" });
    await change.click();
    const confirm = page.getByRole("button", { name: "Confirm change" });
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(change).toBeVisible();
    await expect(page.getByText(OPTION_RECEIVE)).toBeVisible();
    await change.click();
    await confirm.click();
    await expect(page.getByRole("heading", { name: "Pay with" })).toBeFocused();
    await expect(page.getByText(OPTION_RECEIVE)).toHaveCount(0);
    await expect(page.locator("[data-money]")).toHaveText("1,250.00 USD");

    await page.getByRole("combobox", { name: "Network" }).click();
    await page.getByRole("option", { name: "Base Sepolia" }).click();
    await showAddress(page).click();
    await expect(page.getByText(RECEIVE)).toBeVisible();
    await expect(page.getByText(OPTION_RECEIVE)).toHaveCount(0);

    // Money arrived on the Base option: it is the invoice's now, with no selects.
    await page.clock.runFor(POLL_MS * 2);
    await expect(page.getByRole("combobox", { name: "Network" })).toHaveCount(0);
    await expect(page.getByText("on Base Sepolia", { exact: true })).toBeVisible();
  });

  test("leads with the payee, links the footer to Forwend, and offers the way back once paid (R-62)", async ({
    page,
  }) => {
    await openPay(
      page,
      { ...OPEN, returnUrl: "https://shop.example/thanks" },
      { ...PAID, returnUrl: "https://shop.example/thanks" },
    );
    // The payee's page: Forwend shows only in the footer.
    await expect(page.getByRole("link", { name: "Forwend", exact: true })).toHaveCount(0);
    const footer = page.getByRole("link", { name: "Payments by Forwend (opens in a new tab)" });
    await expect(footer).toHaveAttribute("href", "/");
    await expect(footer).toHaveAttribute("target", "_blank");
    const back = page.getByRole("link", { name: "Back to shop.example" });
    await expect(back).toHaveCount(0);
    await page.clock.runFor(POLL_MS);
    await expect(back).toHaveAttribute("href", "https://shop.example/thanks");
    await expect(page.getByRole("button", { name: "Check status" })).toHaveCount(0);
  });

  test("shows a merchant store's logo in place of the initial tile (R-135)", async ({ page }) => {
    const store = "33333333-3333-4333-8333-333333333333";
    // Any PNG will do: a screenshot of the blank page.
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 40, height: 20 } });
    await page.route(`**/api/v1/stores/${store}/logo.png*`, (route) =>
      route.fulfill({ contentType: "image/png", body: png }),
    );
    const brand = { storeId: store, color: "#d01020", logoAt: "2026-10-10T10:00:00Z" };
    await openPay(page, { ...OPEN, brand });
    const logo = page.locator(`img[src^="/api/v1/stores/${store}/logo.png?v="]`);
    await expect(logo).toBeVisible();
    await logo.evaluate((img) => (img as HTMLImageElement).decode());
    expect(await logo.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(40);
    await expect(page.getByRole("heading", { level: 1, name: "Alice Design GmbH" })).toBeVisible();
    expect(await blockingViolations(page)).toEqual([]);
    await mockInvoice(page, { ...OPEN, brand: { ...brand, logoAt: null } });
    await page.reload();
    await expect(page.getByText("A", { exact: true })).toBeVisible();
    await expect(logo).toHaveCount(0);
  });

  test("shows no address and warns the payer when a term does not match the address", async ({
    page,
  }) => {
    await openPay(page, { ...OPEN, amount: "1250000001" });
    await expect(
      page.getByRole("alert").filter({
        hasText: "This payment page does not match the payment. Do not pay; contact the recipient.",
      }),
    ).toBeVisible();
    await expect(showAddress(page)).toHaveCount(0);
    await expect(page.getByText(RECEIVE)).toHaveCount(0);
    await expect(page.getByRole("img", { name: /QR code/ })).toHaveCount(0);
  });

  test("lets the canary read the shown address, or why there is none", async ({ browser }) => {
    const read = async (body: object, id = PAY) => {
      const page = await browser.newPage();
      await page.clock.install({ time: NOW });
      await mockInvoice(page, body);
      const result = await readPayPage(page, PUBLIC_URL, id);
      await page.close();
      return result;
    };
    expect(await read(OPEN)).toEqual({
      id: PAY,
      addresses: [RECEIVE],
      qrMatches: true,
      amountText: expect.stringMatching(/USDC[\s\S]*Base Sepolia/),
    });
    expect(await read(PAID)).toEqual({
      id: PAY,
      error: "no address shown: the invoice is not open for payment",
    });
    expect((await read({ ...OPEN, amount: "1250000001" })).error).toMatch(
      /^page alert: This payment page does not match/,
    );

    // R-56
    const option = `${PAY}?option=${OPTION_ID}`;
    expect(await read(CHOOSING, option)).toEqual({
      id: option,
      addresses: [OPTION_RECEIVE],
      qrMatches: true,
      amountText: expect.stringMatching(/USDC[\s\S]*Arbitrum Sepolia/),
    });
    const tampered = {
      ...CHOOSING,
      options: [MAIN_OPTION, { ...CHOOSING.options[1], amount: "1250000001" }],
    };
    expect((await read(tampered, option)).error).toMatch(
      /^page alert: This payment page does not match/,
    );
    // Once an option has money, the page shows that one whatever the link asks for.
    expect((await read({ ...CHOOSING, optionLocked: true }, option)).addresses).toEqual([RECEIVE]);
  });

  test("answers 404 for a malformed id and shows the 404 page for an unknown one", async ({
    page,
  }) => {
    expect((await page.goto("/pay/not-an-invoice"))?.status()).toBe(404);
    // The on-chain id is public, so it is no pay link (D-86).
    expect((await page.goto(`/pay/${ID}`))?.status()).toBe(404);
    await page.route("**/api/v1/invoices/*", (route) =>
      route.fulfill({
        status: 404,
        json: { error: { code: "invoice_not_found", message: "invoice not found" } },
      }),
    );
    await page.goto(`/pay/${PAY}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This path ends here.");
  });

  test("the address stays on one line once copied, and Copy keeps its width", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await openPay(page, OPEN);
    await showAddress(page).click();
    const shown = page.locator("[data-address]");
    for (const width of [1440, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      const copy = page.getByRole("button", { name: "Copy address" });
      const before = await copy.boundingBox();
      await copy.click();
      const copied = page.getByRole("button", { name: "Address copied" });
      await expect(copied).toBeVisible();
      expect((await copied.boundingBox())?.width).toBe(before?.width);
      const line = await shown.evaluate((el) => Number.parseFloat(getComputedStyle(el).lineHeight));
      expect((await shown.boundingBox())?.height).toBeLessThanOrEqual(line + 1);
    }
  });

  test("fits a 390 px phone in one column without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // The longest reference the API takes, with no space to break at.
    await openPay(page, { ...OPEN, reference: `PO-${"4".repeat(97)}` });
    await showAddress(page).click();
    await expect(page.getByText(RECEIVE)).toBeVisible();
    const overflow = () => sidewaysScroll(page);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await mockInvoice(page, PAID);
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: /^Paid$/ })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`has no serious or critical axe violations in the ${colorScheme} theme`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ colorScheme, reducedMotion: "reduce" });
      const page = await context.newPage();
      const blocking = async () =>
        (await new AxeBuilder({ page }).analyze()).violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
      await openPay(page, OPEN, CONFIRMING);
      await showAddress(page).click();
      await expect(page.getByText(RECEIVE)).toBeVisible();
      expect(await blocking()).toEqual([]);
      await page.clock.runFor(POLL_MS);
      await expect(status(page)).toContainText(/Confirming/);
      expect(await blocking()).toEqual([]);
      await mockInvoice(page, PAID);
      await page.reload();
      await expect(page.getByRole("status").filter({ hasText: /^Paid$/ })).toBeVisible();
      expect(await blocking()).toEqual([]);
      await context.close();
    });
  }
});

// R-168: the checkout inside a merchant's page.
test.describe("embedded checkout", () => {
  // Both origins are the shared stub (e2e/stub-api.mjs), so Chromium sees a local page framing a local one. PARENT is
  // a store's allowed origin and its /shop frames ?src; OTHER is another site.
  const PARENT = `http://localhost:${API_PORT}`;
  const OTHER = `http://127.0.0.1:${API_PORT}`;
  const RETURN = "https://shop.example.com/done";

  const embedUrl = (layout: string, origin = PARENT, theme = "") =>
    `${PUBLIC_URL}/embed/${PAY}?layout=${layout}&origin=${encodeURIComponent(origin)}${theme ? `&theme=${theme}` : ""}`;

  type Heard = { origin: string; data: Record<string, unknown> };
  async function openShop(page: Page, origin: string, src: string, ...bodies: object[]) {
    await page.clock.install({ time: NOW });
    await mockInvoice(page, ...bodies);
    await page.goto(`${origin}/shop?src=${encodeURIComponent(src)}`);
    return page.frameLocator("iframe");
  }
  const heard = (page: Page) =>
    page.evaluate(() => (window as unknown as { heard: Heard[] }).heard);
  const message = async (page: Page, type: string) =>
    (await heard(page)).find((m) => m.data.type === type);

  test("only the origin its store allows can frame an embed, and every other page none", async ({
    request,
  }) => {
    const headers = async (path: string) => (await request.get(path)).headers();
    const framed = await headers(
      `/embed/${PAY}?layout=element&origin=${encodeURIComponent(PARENT)}`,
    );
    // One policy, the pages' own, naming that one origin: a second would apply too. DENY stays: browsers skip it when
    // a policy names frame-ancestors, as the framed tests below show.
    expect(framed["content-security-policy"]).toContain(`frame-ancestors ${PARENT};`);
    expect(framed["content-security-policy"]).toContain("default-src 'self'");
    expect(framed["content-security-policy"]).not.toContain("frame-ancestors 'none'");
    expect(framed["x-frame-options"]).toBe("DENY");
    expect(framed["x-content-type-options"]).toBe("nosniff");
    for (const path of [
      `/embed/${PAY}?origin=${encodeURIComponent(OTHER)}`,
      `/embed/${PAY}`,
      `/embed/not-a-token?origin=${encodeURIComponent(PARENT)}`,
      // Header rules ignore case; the proxy and the routes don't.
      `/EMBED/${PAY}?origin=${encodeURIComponent(PARENT)}`,
    ]) {
      const refused = await headers(path);
      expect(refused["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(refused["x-frame-options"], path).toBe("DENY");
    }
    const pay = await headers(`/pay/${PAY}`);
    expect(pay["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(pay["x-frame-options"]).toBe("DENY");
  });

  test("a page can't frame an embed under another origin's name", async ({ page }) => {
    await openShop(page, OTHER, embedUrl("element", PARENT), OPEN);
    // The browser refuses the frame and shows its own error page in it.
    await expect
      .poll(() => page.frames().map((f) => f.url()))
      .toContain("chrome-error://chromewebdata/");
    expect(await heard(page)).toEqual([]);
  });

  test("an element tells its page its height and payment status, and only hints", async ({
    page,
  }) => {
    const frame = await openShop(page, PARENT, embedUrl("element"), { ...OPEN, returnUrl: RETURN });
    await expect.poll(() => message(page, "ready")).toBeTruthy();
    const ready = await message(page, "ready");
    expect(ready?.origin).toBe(PUBLIC_URL);
    expect(ready?.data).toMatchObject({
      source: "forwend",
      v: 1,
      invoiceId: ID,
      paymentStatus: "open",
    });
    const height = Number(ready?.data.height);
    expect(height).toBeGreaterThan(0);

    // The merchant's page shows the order: the element keeps the payee, the amount and the pay panel.
    await expect(frame.getByText("Alice Design GmbH")).toBeVisible();
    await expect(frame.getByText("Logo design")).toHaveCount(0);
    await expect(frame.getByRole("link", { name: "Open in a new tab" })).toHaveAttribute(
      "href",
      `/pay/${PAY}`,
    );
    await expect(frame.getByRole("link", { name: "Open in a new tab" })).toHaveAttribute(
      "target",
      "_blank",
    );
    // Need help names the frame's own site, and support gets the hosted pay link, not the embed's.
    await frame.getByRole("button", { name: "Need help?" }).click();
    const help = frame.getByRole("dialog", { name: "Need help?" });
    await expect(
      help.getByText(`This checkout comes from ${new URL(PUBLIC_URL).host}.`),
    ).toBeVisible();
    const mail = new URL(
      (await help.getByRole("link", { name: "Email support" }).getAttribute("href")) ?? "",
    );
    expect(mail.searchParams.get("body")).toContain(`Pay link: ${PUBLIC_URL}/pay/${PAY}\n`);
    await help.getByRole("button", { name: "Close" }).click();

    // The frame takes no orders from its page: a forged message changes nothing.
    await page.evaluate(() =>
      document
        .querySelector("iframe")
        ?.contentWindow?.postMessage(
          { source: "forwend", v: 1, type: "status", paymentStatus: "paid" },
          "*",
        ),
    );
    await frame.getByRole("button", { name: "Show address" }).click();
    await expect(frame.getByText(RECEIVE)).toBeVisible();
    await expect
      .poll(async () => Number((await message(page, "resize"))?.data.height))
      .toBeGreaterThan(height);
    expect(await message(page, "status")).toBeUndefined();
    expect(await blockingViolations(page)).toEqual([]);

    await mockInvoice(page, { ...PAID, returnUrl: RETURN });
    await page.clock.runFor(POLL_MS);
    await expect
      .poll(async () => (await message(page, "status"))?.data)
      .toMatchObject({
        type: "status",
        invoiceId: ID,
        paymentStatus: "paid",
      });
    await expect(frame.getByRole("status").filter({ hasText: /^Paid$/ })).toBeVisible();
    // The merchant's page goes on by itself: the element offers no way back.
    await expect(frame.getByRole("link", { name: /Back to/ })).toHaveCount(0);
    for (const m of await heard(page)) expect(m.origin).toBe(PUBLIC_URL);
  });

  test("an expired checkout takes no money in the frame and tells its page", async ({ page }) => {
    const frame = await openShop(page, PARENT, embedUrl("element"), CLOSED);
    await expect
      .poll(async () => (await message(page, "ready"))?.data.paymentStatus)
      .toBe("expired");
    await expect(frame.getByText("Alice Design GmbH", { exact: true })).toBeVisible();
    await expect(frame.getByRole("button", { name: "Show address" })).toHaveCount(0);
    await expect(frame.getByText(/^Closes in/)).toHaveCount(0);
  });

  test("a full embed keeps the whole checkout, takes the page's theme and goes back from the top", async ({
    page,
  }) => {
    const frame = await openShop(page, PARENT, embedUrl("full", PARENT, "dark"), {
      ...PAID,
      returnUrl: RETURN,
    });
    await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(frame.getByText("Logo design")).toBeVisible();
    await expect(frame.getByRole("link", { name: "Back to shop.example.com" })).toHaveAttribute(
      "target",
      "_top",
    );
  });
});
