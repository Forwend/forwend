import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { readPayPage } from "../scripts/canary-pay-page";
import { PUBLIC_URL } from "./servers";
import { sidewaysScroll } from "./sideways";

// ID is keccak256(PAY) (D-86). RECEIVE is factory.predict of these terms (R-15), so the page shows it
// only while every term is unchanged.
const PAY = "7f3a9c1e5b2d4086a1c3e5f7092b4d6f8a0c2e4f6a8b0d2f4e6c8a0b2d4f6e81";
const ID = "0x0bc3ec4e72d7b5f3cc8a059ea1a0f06cc9d24ea5e71a2acfd86fea75540e9a31";
const RECEIVE = "0x25425f508790c1847090371590297cad428868f3";
// A second option of a payer-chooses invoice (R-56): USDC on Arbitrum Sepolia, its id derived from ID as the API does
// (keccak256(abi.encode(ID, 421614, token))) and the address predict gives for the same terms with that id.
const OPTION_ID = "0x285391c5b8b001b41a459f4011b40661d4c83c871d3f0d7881682bbced83a1c1";
const OPTION_RECEIVE = "0x66d0b871c6371d997f8bf34ea320927aff32dc6f";
const NOW = new Date("2026-10-10T12:00:00Z");
const POLL_MS = 15_000;

const MAIN_OPTION = {
  optionId: ID,
  chainId: 84532,
  network: "base-sepolia",
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
  amount: "1250000000",
  receiveAddress: RECEIVE,
  deposits: [] as object[],
};

const OPEN = {
  invoiceId: ID,
  payToken: PAY,
  optionId: ID,
  optionLocked: false,
  optionCount: 1,
  confirming: false,
  closed: false,
  senderName: null as string | null,
  returnUrl: null as string | null,
  nextCheckAt: null,
  updates: [],
  replacedBy: null,
  lines: [],
  options: [MAIN_OPTION],
  number: 1,
  title: "Logo design",
  note: "Thanks for the work together.",
  dueDate: "2026-11-01",
  supplyDate: null,
  reference: "PO-4500012345" as string | null,
  agreedValue: { currency: "EUR", amount: "115000", decimals: 2, date: "2026-10-09" } as
    | object
    | null,
  issuer: {
    name: "Alice Design GmbH",
    address: "Hauptstr. 1\n10115 Berlin",
    country: "DE",
    taxId: null,
    email: "billing@alice.example",
  },
  chainId: 84532,
  livemode: false,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  amount: "1250000000",
  recipient: "0x1111111111111111111111111111111111111111",
  factory: "0xece745390524e4d0b05d26f56af7f1d38fdb7546",
  receiveAddress: RECEIVE,
  expiresAt: "2026-10-17T15:00:00Z",
  closesAt: "2026-10-17T15:00:00Z",
  settleDeadline: "2026-10-18T15:00:00Z",
  paymentStatus: "open",
  settlementStatus: "none",
  refundStatus: "none",
  settlementTxHash: null,
  createdAt: "2026-10-10T11:00:00Z",
  paidAt: null as string | null,
  settledAt: null as string | null,
  canceledAt: null,
  deposits: [] as object[],
};
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

async function mockInvoice(page: Page, ...bodies: object[]) {
  let call = 0;
  await page.route("**/api/v1/invoices/*", (route) =>
    route.fulfill({ json: bodies[Math.min(call++, bodies.length - 1)] }),
  );
}

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
      "Forwend never asks you to pay a different address or an extra fee.",
    );
    await expect(scam).toBeHidden();
    await page.getByRole("contentinfo").getByRole("button", { name: "Need help?" }).click();
    const help = page.getByRole("dialog", { name: "Need help?" });
    await expect(
      help.getByText("Forwend never asks you to pay a different address or an extra fee."),
    ).toBeVisible();
    await expect(
      help.locator("li", { hasText: `You are on ${new URL(PUBLIC_URL).host}.` }),
    ).toBeVisible();
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

  test("a test-mode invoice says its tokens have no value, and a live one doesn't (R-143)", async ({
    page,
  }) => {
    await openPay(page, OPEN);
    const note = page.getByText(
      "Test mode: this payment takes testnet tokens, which have no value. Don't send real money.",
    );
    await expect(note).toBeVisible();
    await mockInvoice(page, { ...OPEN, livemode: true });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alice Design GmbH");
    await expect(note).toHaveCount(0);
  });

  // R-55
  test("Check status says what it found and when the next check is allowed", async ({ page }) => {
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
          unreadable: [421614],
        },
      });
    });
    const check = page.getByRole("button", { name: "Check status" });
    await check.click();
    await expect(page.getByRole("status").filter({ hasText: /^Found/ })).toHaveText(
      "Found 1,250.00 USDC. Recording it now. · Arbitrum Sepolia did not answer.",
    );
    await expect(page.getByText(/· Next check in 5 min$/)).toBeVisible();
    await expect(check).toBeDisabled();
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
          unreadable: [],
        },
      }),
    );
    const waiting = page.getByRole("status").filter({ hasText: "Waiting for payment…" });
    const check = page.getByRole("button", { name: "Check status" });
    const answer = page.getByText(/· Next check in 5 min$/);
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
    await expect(status(page)).toContainText("Confirming (6/12) · about 2 min left");
    await page.reload();
    await expect(status(page)).toContainText("Confirming (6/12) · about 2 min left");
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
    await expect(status(page)).toContainText("Confirming (0/12) · about 3 min left");
    await expect(page.getByText(RECEIVE)).toHaveCount(0);
    await expect(page.locator("[data-status]")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Paying with" })).toBeVisible();
    const steps = page.getByRole("list", { name: "Payment progress" });
    await expect(steps.getByRole("listitem")).toHaveText([/^Detected/, /^Confirming/, /^Paid/]);
    await expect(steps.locator("[aria-current=step]")).toHaveText("Confirming");
    await expect(status(page).getByRole("button", { name: "About 3 min left" })).toBeVisible();
    await expect(status(page).getByText("0 / 12 blocks confirmed", { exact: true })).toBeVisible();
    const payment = page.getByRole("region", { name: "Payment progress" }).locator("ul > li");
    await expect(payment).toContainText("1,250.00 USDC");
    await expect(payment).toContainText("0x3333…3333");
    await expect(payment.getByRole("link", { name: /Basescan/ })).toHaveAttribute(
      "href",
      `https://sepolia.basescan.org/tx/${DEPOSIT.txHash}`,
    );

    await page.clock.runFor(POLL_MS);
    await expect(status(page)).toContainText("Confirming (6/12) · about 2 min left");

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

  // R-79
  test("tells the payer a canceled invoice takes no money", async ({ page }) => {
    await openPay(page, CANCELED);
    await expect(status(page)).toHaveText(
      "Alice Design GmbH closed this payment. Do not send money.",
    );
    await expect(showAddress(page)).toHaveCount(0);
    await expect(page.getByText("Amount", { exact: true })).toBeVisible();

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await mockInvoice(page, { ...CANCELED, deposits: [{ ...DEPOSIT, amount: "250000000" }] });
    await page.reload();
    await expect(
      page.getByText(
        "The 250.00 USDC you sent is held for you; ask Alice Design GmbH to get it back.",
      ),
    ).toBeVisible();
    await expect(showAddress(page)).toHaveCount(0);
  });

  test("says what is left when partly paid, and that a closed invoice takes no more", async ({
    page,
  }) => {
    await openPay(page, PARTIAL, CLOSED);
    await expect(status(page)).toHaveText(
      "250.00 USDC of 1,250.00 USDC received. Send the remaining 1,000.00 USDC.",
    );
    await expect(page.locator("[data-money]").first()).toHaveText("1,000.00 USDC");
    await expect(showAddress(page)).toBeVisible();
    // R-77
    await expect(page.getByText(/^Closes in/)).toBeVisible();
    await expect(page.getByText(/Copy the address from this page for the rest/)).toBeVisible();
    const partlySteps = page.getByRole("list", { name: "Payment progress" });
    await expect(partlySteps.getByText("Partially paid")).toHaveClass(/bg-warning-soft/);
    await expect(partlySteps.getByRole("listitem")).toHaveText([
      /^Detected/,
      /^Confirmed/,
      /^Partially paid/,
    ]);
    await page.clock.runFor(POLL_MS);
    await expect(status(page)).toHaveText(
      "This payment is closed. If you already sent money, it is not lost: contact Alice Design GmbH.",
    );
    await expect(showAddress(page)).toHaveCount(0);
    await expect(page.getByText(/Copy the address from this page/)).toHaveCount(0);
  });

  // R-130: past the terms' expiry, a reopened invoice takes money until its new close.
  test("a reopened invoice shows its address and time left until the new close", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-10-17T20:00:00Z") });
    await mockInvoice(page, { ...PARTIAL, closesAt: "2026-10-18T10:00:00Z" });
    await page.goto(`/pay/${PAY}`);
    await expect(status(page)).toHaveText(
      "250.00 USDC of 1,250.00 USDC received. Send the remaining 1,000.00 USDC.",
    );
    await expect(page.getByText(/^Closes in/)).toBeVisible();
    await showAddress(page).click();
    await expect(page.getByText(RECEIVE)).toBeVisible();
  });

  test("lets the payer pick the network and token with selects, keeps the pick after a reload, and locks it once money arrives", async ({
    page,
  }) => {
    await openPay(page, CHOOSING, CHOOSING, CHOOSING, { ...CHOOSING, optionLocked: true });
    await expect(page.locator("[data-money]")).toHaveText("1,250.00 USD");
    await expect(showAddress(page)).toHaveCount(0);
    const serious = (await new AxeBuilder({ page }).analyze()).violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(serious.map((v) => v.id)).toEqual([]);

    // Arbitrum carries one token, so picking the network picks it.
    await page.getByRole("combobox", { name: "Network" }).click();
    await page.getByRole("option", { name: "Arbitrum Sepolia" }).click();
    await expect(page.getByRole("combobox", { name: "Token" })).toHaveText(/USDC/);
    await expect(page).toHaveURL(new RegExp(`\\?option=${OPTION_ID}$`));
    await showAddress(page).click();
    await expect(page.getByText(OPTION_RECEIVE)).toBeVisible();
    // R-78
    await expect(page.getByRole("note")).toHaveText(
      "Send only USDC on Arbitrum Sepolia. Native USDC, not USDC.e.",
    );
    await expect(page.getByRole("link", { name: /0x75fa.*aa4d/ })).toHaveAttribute(
      "href",
      "https://sepolia.arbiscan.io/address/0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
    );

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

  test("links the logo home and the footer to Forwend, and offers the way back once paid (R-62)", async ({
    page,
  }) => {
    await openPay(
      page,
      { ...OPEN, returnUrl: "https://shop.example/thanks" },
      { ...PAID, returnUrl: "https://shop.example/thanks" },
    );
    await expect(page.getByRole("link", { name: "Forwend", exact: true })).toHaveAttribute(
      "href",
      "/",
    );
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
    expect(await logo.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(40);
    await expect(page.getByRole("heading", { level: 1, name: "Alice Design GmbH" })).toBeVisible();
    const blocking = async () =>
      (await new AxeBuilder({ page }).analyze()).violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => v.id);
    expect(await blocking()).toEqual([]);
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
