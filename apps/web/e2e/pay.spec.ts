import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { readPayPage } from "../scripts/canary-pay-page";
import { PUBLIC_URL } from "./servers";

// A sample invoice as GET /v1/invoices/{id} returns it. RECEIVE is factory.predict of these terms (the unit test checks
// the computation against the R-15 vectors), so the page shows it only while every term is unchanged.
const ID = "0x7f3a9c1e5b2d4086a1c3e5f7092b4d6f8a0c2e4f6a8b0d2f4e6c8a0b2d4f6e81";
const RECEIVE = "0x586134f74b654f5835860ca198ae725344670078";
// A second option of a payer-chooses invoice (R-56): USDC on Arbitrum Sepolia, its id derived from ID as the API does
// (keccak256(abi.encode(ID, 421614, token))) and the address predict gives for the same terms with that id.
const OPTION_ID = "0x80166bc7ad9374378c99215bffabc884c9fe82e8876840816d1eb4e5710a89e7";
const OPTION_RECEIVE = "0xdb27b5da140247ca45e078798de10030638c2ba3";
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
  optionId: ID,
  optionLocked: false,
  optionCount: 1,
  confirming: false,
  senderName: null as string | null,
  returnUrl: null as string | null,
  nextCheckAt: null,
  options: [MAIN_OPTION],
  number: 1,
  title: "Logo design",
  note: "Thanks for the work together.",
  dueDate: "2026-11-01",
  issuer: {
    name: "Alice Design GmbH",
    address: "Hauptstr. 1\n10115 Berlin",
    country: "DE",
    taxId: null,
    email: "billing@alice.example",
  },
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  amount: "1250000000",
  recipient: "0x1111111111111111111111111111111111111111",
  factory: "0xece745390524e4d0b05d26f56af7f1d38fdb7546",
  receiveAddress: RECEIVE,
  expiresAt: "2026-10-17T15:00:00Z",
  settleDeadline: "2026-10-18T15:00:00Z",
  paymentStatus: "open",
  settlementStatus: "none",
  refundStatus: "none",
  settlementTxHash: null,
  createdAt: "2026-10-10T11:00:00Z",
  paidAt: null as string | null,
  settledAt: null as string | null,
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
  blocksLeft: 12,
  blocksTotal: 12,
  secondsLeft: 150,
};
const DETECTED = { ...OPEN, paymentStatus: "detected", confirming: true, deposits: [DEPOSIT] };
// The next read: half the blocks have passed.
const CONFIRMING = {
  ...DETECTED,
  deposits: [{ ...DEPOSIT, blocksLeft: 6, secondsLeft: 75 }],
};
const CONFIRMED = [
  { ...DEPOSIT, status: "confirmed", blocksLeft: 0, blocksTotal: 0, secondsLeft: 0 },
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

/** Answers the invoice read with each body in turn, then keeps the last; never reaches a backend. */
async function mockInvoice(page: Page, ...bodies: object[]) {
  let call = 0;
  await page.route("**/api/v1/invoices/*", (route) =>
    route.fulfill({ json: bodies[Math.min(call++, bodies.length - 1)] }),
  );
}

async function openPay(page: Page, ...bodies: object[]) {
  await page.clock.install({ time: NOW });
  await mockInvoice(page, ...bodies);
  await page.goto(`/pay/${ID}`);
}

const showAddress = (page: Page) => page.getByRole("button", { name: "Show address" });
const status = (page: Page) => page.getByRole("status").filter({ hasText: /./ }).first();
const pdfPath = (file: string) => `/api/v1/invoices/${ID}/${file}`;
const PARTIAL = {
  ...OPEN,
  paymentStatus: "partially_paid",
  deposits: [
    {
      ...DEPOSIT,
      amount: "250000000",
      status: "confirmed",
      blocksLeft: 0,
      blocksTotal: 0,
      secondsLeft: 0,
    },
  ],
};
const CLOSED = { ...OPEN, paymentStatus: "expired" };

// R-68: one short screen: who asks, the amount, Pay with, the address on request, one status line.
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
    await expect(page.getByText("Invoice INV-0001 · Logo design")).toBeVisible();
    await expect(page.locator("[data-money]")).toHaveText("1,250.00 USDC");
    await expect(page.getByText("on Base Sepolia", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download invoice PDF" })).toHaveAttribute(
      "href",
      pdfPath("invoice.pdf"),
    );
    // Nothing to wait for before there is an address: no status and no Check status yet (R-68).
    await expect(page.getByText("Waiting for payment…")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Check status" })).toHaveCount(0);
    // No filler: no testnet notice, no steps; the rules open from the footer in a dialog, so the box never grows.
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
    await expect(status(page)).toHaveText("Waiting for payment…");
    await expect(page.getByRole("button", { name: "Check status" })).toBeVisible();
    // A reload in the same tab keeps the address shown.
    await page.reload();
    await expect(page.getByText(RECEIVE)).toBeVisible();

    expect(scripts.length).toBeGreaterThan(0);
    for (const url of scripts) expect(new URL(url).origin, url).toBe(new URL(PUBLIC_URL).origin);
  });

  // R-55: Check status asks Forwend to look again, says what it found and rests until the next check, also after a
  // reload.
  test("Check status says what it found and when the next check is allowed", async ({ page }) => {
    await openPay(page, OPEN);
    await showAddress(page).click();
    let calls = 0;
    await page.route(`**/api/v1/invoices/${ID}/recheck`, (route) => {
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
    // The read says the same after a reload.
    await mockInvoice(page, {
      ...OPEN,
      nextCheckAt: new Date(NOW.getTime() + 240_000).toISOString(),
    });
    await page.reload();
    await expect(check).toBeDisabled();
    await expect(page.getByText("Next check in 4 min", { exact: true })).toBeVisible();
  });

  test("Check status asked too soon rests instead of reporting a network failure", async ({
    page,
  }) => {
    await openPay(page, OPEN);
    await showAddress(page).click();
    await page.route(`**/api/v1/invoices/${ID}/recheck`, (route) =>
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
    // It comes back once the wait is over.
    await page.clock.runFor(31_000);
    await expect(check).toBeEnabled();
  });

  // R-73: the count comes from the API, so a page opened halfway through says how far it got.
  test("a page opened while a payment confirms counts the blocks already passed", async ({
    page,
  }) => {
    await openPay(page, CONFIRMING);
    await expect(status(page)).toHaveText("Confirming (6/12) · about 2 min left");
    await page.reload();
    await expect(status(page)).toHaveText("Confirming (6/12) · about 2 min left");
  });

  test("follows the payment from waiting to paid without a reload, and never shows Settled", async ({
    page,
  }) => {
    await openPay(page, OPEN, DETECTED, CONFIRMING, PAID, SETTLED);
    await page.evaluate(() => {
      (window as unknown as { stayed: boolean }).stayed = true;
    });
    await showAddress(page).click();
    await expect(status(page)).toHaveText("Waiting for payment…");

    // The full amount is on its way: no address invites a second payment. The box keeps its place and follows it:
    // Detected, Confirming and Paid, the count, and the payment with its transaction (R-68).
    await page.clock.runFor(POLL_MS);
    await expect(status(page)).toHaveText("Confirming (0/12) · about 3 min left");
    await expect(page.getByText(RECEIVE)).toHaveCount(0);
    await expect(page.locator("[data-status]")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Paying with" })).toBeVisible();
    const steps = page.getByRole("list", { name: "Payment progress" });
    await expect(steps.getByRole("listitem")).toHaveText([/^Detected/, /^Confirming/, /^Paid/]);
    // The step carries the count, the time sits behind its clock, and no visible line repeats it (R-68).
    await expect(steps.locator("[aria-current=step]")).toHaveText("Confirming (0/12)");
    await expect(steps.getByRole("button", { name: "About 3 min left" })).toBeVisible();
    await expect(status(page)).toHaveClass(/sr-only/);
    const payment = page.getByRole("region", { name: "Payment progress" }).locator("ul > li");
    await expect(payment).toContainText("1,250.00 USDC");
    await expect(payment).toContainText("0x3333…3333");
    await expect(payment.getByRole("link", { name: /Basescan/ })).toHaveAttribute(
      "href",
      `https://sepolia.basescan.org/tx/${DEPOSIT.txHash}`,
    );

    await page.clock.runFor(POLL_MS);
    await expect(status(page)).toHaveText("Confirming (6/12) · about 2 min left");

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
  });

  test("says what is left when partly paid, and that a closed invoice takes no more", async ({
    page,
  }) => {
    await openPay(page, PARTIAL, CLOSED);
    await expect(status(page)).toHaveText(
      "250.00 USDC of 1,250.00 USDC received. Send the remaining 1,000.00 USDC.",
    );
    await expect(page.locator("[data-money]").first()).toHaveText("1,000.00 USDC");
    // Money is still due: the address stays, and the Paid step says it is partly there.
    await expect(showAddress(page)).toBeVisible();
    const partlySteps = page.getByRole("list", { name: "Payment progress" });
    await expect(partlySteps.getByText("Partially paid")).toHaveClass(/bg-warning-soft/);
    // Done, the step says Confirmed rather than Confirming.
    await expect(partlySteps.getByRole("listitem")).toHaveText([
      /^Detected/,
      /^Confirmed/,
      /^Partially paid/,
    ]);
    await page.clock.runFor(POLL_MS);
    await expect(status(page)).toHaveText(
      "This invoice is closed. If you already sent money, it is not lost: contact Alice Design GmbH.",
    );
    await expect(showAddress(page)).toHaveCount(0);
  });

  test("lets the payer pick the network and token with selects, keeps the pick after a reload, and locks it once money arrives", async ({
    page,
  }) => {
    await openPay(page, CHOOSING, CHOOSING, CHOOSING, { ...CHOOSING, optionLocked: true });
    // Nothing picked: the amount is in USD and no address can show.
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
    await expect(page.getByRole("note")).toHaveText("Send only USDC on Arbitrum Sepolia.");

    // A reload keeps the pick and the shown address; the pick folds into one row.
    await page.reload();
    await expect(page.getByText(OPTION_RECEIVE)).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Network" })).toHaveCount(0);

    // Changing takes two presses, so a payer who already sent does not switch by accident; leaving the button cancels.
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

    // Before any money the pick can change, and the address follows it.
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

  test("shows no address and warns the payer when a term does not match the address", async ({
    page,
  }) => {
    await openPay(page, { ...OPEN, amount: "1250000001" });
    await expect(
      page.getByRole("alert").filter({
        hasText:
          "This payment page does not match the invoice. Do not pay; contact the invoice's creator.",
      }),
    ).toBeVisible();
    await expect(showAddress(page)).toHaveCount(0);
    await expect(page.getByText(RECEIVE)).toHaveCount(0);
    await expect(page.getByRole("img", { name: /QR code/ })).toHaveCount(0);
  });

  test("lets the canary read the shown address, or why there is none", async ({ browser }) => {
    const read = async (body: object, id = ID) => {
      const page = await browser.newPage();
      await page.clock.install({ time: NOW });
      await mockInvoice(page, body);
      const result = await readPayPage(page, PUBLIC_URL, id);
      await page.close();
      return result;
    };
    expect(await read(OPEN)).toEqual({
      id: ID,
      addresses: [RECEIVE],
      qrMatches: true,
      amountText: expect.stringMatching(/USDC[\s\S]*Base Sepolia/),
    });
    expect(await read(PAID)).toEqual({
      id: ID,
      error: "no address shown: the invoice is not open for payment",
    });
    expect((await read({ ...OPEN, amount: "1250000001" })).error).toMatch(
      /^page alert: This payment page does not match/,
    );

    // Each option of a payer-chooses invoice opens by ?option=, checked against its own terms (R-56).
    const option = `${ID}?option=${OPTION_ID}`;
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
    await page.route("**/api/v1/invoices/*", (route) =>
      route.fulfill({
        status: 404,
        json: { error: { code: "invoice_not_found", message: "invoice not found" } },
      }),
    );
    await page.goto(`/pay/${ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This path ends here.");
  });

  test("fits a 390 px phone in one column without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPay(page, OPEN);
    await showAddress(page).click();
    await expect(page.getByText(RECEIVE)).toBeVisible();
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
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
      await expect(status(page)).toHaveText(/^Confirming/);
      expect(await blocking()).toEqual([]);
      await mockInvoice(page, PAID);
      await page.reload();
      await expect(page.getByRole("status").filter({ hasText: /^Paid$/ })).toBeVisible();
      expect(await blocking()).toEqual([]);
      await context.close();
    });
  }
});
