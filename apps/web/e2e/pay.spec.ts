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
};

const OPEN = {
  invoiceId: ID,
  optionId: ID,
  optionLocked: false,
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
  secondsLeft: 150,
};
const DETECTED = { ...OPEN, paymentStatus: "detected", deposits: [DEPOSIT] };
// The next read: half the blocks have passed.
const CONFIRMING = {
  ...DETECTED,
  deposits: [{ ...DEPOSIT, blocksLeft: 6, secondsLeft: 75 }],
};
const CONFIRMED = [{ ...DEPOSIT, status: "confirmed", blocksLeft: 0, secondsLeft: 0 }];
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

const confirmButton = (page: Page) =>
  page.getByRole("button", { name: "I will send USDC on Base Sepolia" });
const method = (page: Page, name: "From a wallet" | "From an exchange") =>
  page.getByRole("button", { name: new RegExp(`^${name}`) });
// Steps 1 and 2: confirm the network, then pay from a wallet.
const startPaying = async (page: Page) => {
  await confirmButton(page).click();
  await method(page, "From a wallet").click();
};
const receipt = (page: Page) => page.getByRole("region", { name: "Receipt" });
const pdfPath = (file: string) => `/api/v1/invoices/${ID}/${file}`;

test.describe("pay page", () => {
  test("shows who asks and the rules, then the address only after the payer confirms the network", async ({
    page,
  }) => {
    const scripts: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "script") scripts.push(r.url());
    });
    await openPay(page, OPEN);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alice Design GmbH");
    await expect(
      page.getByText("The sender gave this name. Forwend doesn't check it."),
    ).toBeVisible();
    await expect(page.getByText("Invoice INV-0001 · Logo design")).toBeVisible();
    await expect(page.locator("[data-money]")).toHaveText("1,250.00 USDC");
    await expect(page.getByText("Base Sepolia", { exact: true }).first()).toBeVisible();
    await expect(
      page.locator("li", { hasText: `You are on ${new URL(PUBLIC_URL).host}.` }),
    ).toBeVisible();
    await expect(
      page.getByText(/^If you send more, or pay after the checkout closes/),
    ).toBeVisible();
    await expect(
      page.getByText("Forwend never asks you to pay a different address or an extra fee."),
    ).toBeVisible();
    await expect(page.getByText(/is a test network/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Download invoice PDF" })).toHaveAttribute(
      "href",
      pdfPath("invoice.pdf"),
    );
    await expect(receipt(page)).toHaveCount(0);
    await expect(page.getByText(RECEIVE)).toHaveCount(0);
    await expect(page.getByRole("img", { name: /QR code/ })).toHaveCount(0);

    // One step at a time: the network first, then how to pay, and only then the address.
    await confirmButton(page).click();
    await expect(page.getByRole("heading", { name: "How you pay" })).toBeFocused();
    await expect(page.getByText(RECEIVE)).toHaveCount(0);
    await method(page, "From a wallet").click();
    await expect(page.getByRole("heading", { name: "Send the payment" })).toBeFocused();
    await expect(page.getByText(RECEIVE)).toBeVisible();
    await expect(page.getByRole("img", { name: "QR code of the address to pay" })).toBeVisible();
    await expect(
      page.getByText("Open your wallet and choose the Base Sepolia network."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Change how you pay" }).click();
    await method(page, "From an exchange").click();
    await expect(
      page.getByText(/^Choose Withdraw, then USDC, then the Base Sepolia network/),
    ).toBeVisible();
    await expect(page.getByText(/withdrawal fee/)).toBeVisible();
    await expect(page.getByText(RECEIVE)).toBeVisible();

    expect(scripts.length).toBeGreaterThan(0);
    for (const url of scripts) expect(new URL(url).origin, url).toBe(new URL(PUBLIC_URL).origin);
  });

  // R-55: Check status asks Forwend to look at the address again, says what it found and rests until the next check.
  test("Check status asks Forwend to look again and says what it found", async ({ page }) => {
    await openPay(page, OPEN);
    let calls = 0;
    await page.route(`**/api/v1/invoices/${ID}/recheck`, (route) => {
      calls++;
      return route.fulfill({
        json: {
          onChain: "1250000000",
          recorded: "0",
          rescanning: true,
          nextCheckAt: new Date(NOW.getTime() + 30_000).toISOString(),
          unreadable: [421614],
        },
      });
    });
    const check = page.getByRole("button", { name: "Check status" });
    await check.click();
    // A network that did not answer is named; the others were still checked (F144).
    await expect(page.getByRole("status").filter({ hasText: /^Found/ })).toHaveText(
      "Found 1,250.00 USDC that is not recorded yet. Recording it now; this page updates by itself. Arbitrum Sepolia did not answer; check again in a moment.",
    );
    await expect(check).toBeDisabled();
    expect(calls).toBe(1);
  });

  test("moves from waiting to detected, confirming, paid and settled without a reload", async ({
    page,
  }) => {
    await openPay(page, OPEN, DETECTED, CONFIRMING, PAID, SETTLED);
    await page.evaluate(() => {
      (window as unknown as { stayed: boolean }).stayed = true;
    });
    const status = page.getByRole("status").filter({ hasText: /./ });
    // The amount panel's pill; each payment below has its own.
    const pill = page.locator("[data-status]").first();
    const progress = page.getByRole("list", { name: "Payment progress" });

    await expect(status).toHaveText(/^Waiting for your payment/);
    await expect(pill).toHaveText("Waiting for payment");

    // A short line, the blocks apart; the pill and the step show a payment on its way, not done.
    await page.clock.runFor(POLL_MS);
    await expect(status).toHaveText("Confirming (0/12) · about 3 min left");
    await expect(pill).toHaveText("Detected");
    await expect(pill).toHaveAttribute("data-status", "detected");
    await expect(progress.locator("[aria-current=step]")).toHaveText("Confirming");
    // The full amount is on its way: no address invites a second payment.
    await expect(confirmButton(page)).toHaveCount(0);

    // What arrived, with proof on the chain's explorer.
    const explorer = page.getByRole("link", { name: "View transaction on Basescan" });
    const payment = page.getByRole("listitem").filter({ has: explorer });
    await expect(payment).toContainText(/1,250\.00\s*USDC\s*Confirming/);
    await expect(explorer).toHaveAttribute(
      "href",
      `https://sepolia.basescan.org/tx/${DEPOSIT.txHash}`,
    );
    await expect(explorer).toHaveAttribute("target", "_blank");
    await expect(explorer).toHaveAttribute("rel", "noopener noreferrer");
    // Who sent it and when: the short sender, the full address as its name and in a tooltip on focus.
    const sender = payment.getByRole("button", { name: SENDER });
    await expect(sender).toHaveText("0x8ba1…ba72");
    await expect(payment.locator("time")).toHaveAttribute("datetime", DEPOSIT.blockTime);
    // Radix closes a tooltip on scroll, and the first focus may scroll the button into view: focus again.
    await expect(async () => {
      await sender.blur();
      await sender.focus();
      await expect(page.getByRole("tooltip")).toHaveText(SENDER, { timeout: 1000 });
    }).toPass();

    await page.clock.runFor(POLL_MS);
    await expect(status).toHaveText("Confirming (6/12) · about 2 min left");

    await page.clock.runFor(POLL_MS);
    await expect(status).toHaveText(/^Paid\. Forwend is now sending the money/);

    await page.clock.runFor(POLL_MS);
    await expect(status).toHaveText(/^Settled\. The sender has received the money/);
    await expect(pill).toHaveText("Settled");
    expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(
      true,
    );
  });

  test("lets the payer pick the network, then the token, change it before paying, and locks it once money arrives", async ({
    page,
  }) => {
    await openPay(page, CHOOSING, CHOOSING, { ...CHOOSING, optionLocked: true });
    // Nothing picked: the amount is in USD, no network is named and Continue stays off (R-57).
    await expect(page.locator("[data-money]")).toHaveText("1,250.00 USD");
    const network = page.getByRole("group", { name: "Network" });
    await expect(network.getByRole("radio")).toHaveCount(2);
    const next = page.getByRole("button", { name: "Choose a network and token" });
    await expect(next).toBeDisabled();
    const serious = (await new AxeBuilder({ page }).analyze()).violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(serious.map((v) => v.id)).toEqual([]);

    // Arbitrum carries one token, so picking the network picks it.
    await network.getByText("Arbitrum Sepolia").click();
    await expect(page.locator("[data-money]")).toHaveText("1,250.00 USDC");
    await page.getByRole("button", { name: "I will send USDC on Arbitrum Sepolia" }).click();
    await method(page, "From a wallet").click();
    await expect(page.getByText(OPTION_RECEIVE)).toBeVisible();
    await expect(page.getByText(RECEIVE)).toHaveCount(0);

    // Before any money, Change opens the choice again and the address follows it.
    await page.getByRole("button", { name: "Change network and token" }).click();
    await network.getByText("Base Sepolia").click();
    await confirmButton(page).click();
    await expect(page.getByText(RECEIVE)).toBeVisible();
    await expect(page.getByText(OPTION_RECEIVE)).toHaveCount(0);

    // Money arrived on the Base option: the choice is the invoice's now, with no picker.
    await page.clock.runFor(POLL_MS * 2);
    await page.getByRole("button", { name: "Change network and token" }).click();
    await expect(page.getByRole("group", { name: "Network" })).toHaveCount(0);
    await expect(page.getByText("The only way to pay this invoice")).toBeVisible();
  });

  test("links the logo home and the footer to Forwend, and offers the way back once paid (R-62)", async ({
    page,
  }) => {
    await openPay(
      page,
      { ...OPEN, returnUrl: "https://shop.example/thanks" },
      {
        ...PAID,
        returnUrl: "https://shop.example/thanks",
      },
    );
    await expect(page.getByRole("link", { name: "Forwend", exact: true })).toHaveAttribute(
      "href",
      "/",
    );
    const footer = page.getByRole("link", { name: "Payments by Forwend (opens in a new tab)" });
    await expect(footer).toHaveAttribute("href", "/");
    await expect(footer).toHaveAttribute("target", "_blank");
    await expect(page.getByText("You don't need an account")).toHaveCount(0);
    const back = page.getByRole("link", { name: "Back to shop.example" });
    await expect(back).toHaveCount(0);
    await page.clock.runFor(POLL_MS);
    await expect(back).toHaveAttribute("href", "https://shop.example/thanks");
    await expect(page.getByRole("button", { name: "Check status" })).toHaveCount(0);
  });

  test("shows each step of a payment that confirms within one read, without moving the status panel", async ({
    page,
  }) => {
    await openPay(page, OPEN, PAID);
    const progress = page.getByRole("list", { name: "Payment progress" });
    const current = progress.locator("[aria-current=step]");
    await expect(current).toHaveText("Detected");
    await page.clock.runFor(POLL_MS);
    await expect(page.getByRole("status").filter({ hasText: /^Paid\./ })).toBeVisible();
    const panel = page.getByRole("region", { name: "Payment status" });
    const top = (await panel.boundingBox())?.y;
    // The read jumped from waiting to paid; the timeline still passes Confirming and Paid on its way.
    for (const step of ["Confirming", "Paid", "Settled"]) {
      await page.clock.runFor(600);
      await expect(current).toHaveText(step);
      expect((await panel.boundingBox())?.y).toBe(top);
    }
  });

  test("shows a fixed invoice's one option as chosen", async ({ page }) => {
    await openPay(page, OPEN);
    await expect(page.getByRole("group", { name: "Network" })).toHaveCount(0);
    await expect(page.getByText("The only way to pay this invoice")).toBeVisible();
    await expect(confirmButton(page)).toBeEnabled();
  });

  test("shows no address and warns the payer when a term does not match the address", async ({
    page,
  }) => {
    await openPay(page, { ...OPEN, amount: "1250000001" });
    await expect(
      page.getByRole("alert").filter({
        hasText: "This payment page does not match the invoice. Do not pay; contact the sender.",
      }),
    ).toBeVisible();
    await expect(confirmButton(page)).toHaveCount(0);
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

  test("fits a 390 px phone without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPay(page, OPEN);
    await startPaying(page);
    await expect(page.getByText(RECEIVE)).toBeVisible();
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    // The receipt's full transaction hashes wrap.
    await mockInvoice(page, SETTLED);
    await page.reload();
    await expect(receipt(page)).toBeVisible();
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
      await startPaying(page);
      await expect(page.getByText(RECEIVE)).toBeVisible();
      expect(await blocking()).toEqual([]);
      // A payment on its way: the pending pills, the filling step and the payment with its explorer link.
      await page.clock.runFor(POLL_MS);
      await expect(page.getByRole("link", { name: "View transaction on Basescan" })).toBeVisible();
      expect(await blocking()).toEqual([]);
      // Settled: the receipt with its hashes, explorer links and PDF link.
      await mockInvoice(page, SETTLED);
      await page.reload();
      await expect(receipt(page)).toBeVisible();
      expect(await blocking()).toEqual([]);
      await context.close();
    });
  }
});

test.describe("pay page receipt", () => {
  test.use({ timezoneId: "UTC", locale: "en-US" });

  test("shows no receipt while paid, then the receipt once settled, beside the invoice PDF", async ({
    page,
  }) => {
    await openPay(page, PAID, SETTLED);
    const invoicePdf = page.getByRole("link", { name: "Download invoice PDF" });
    await expect(page.getByRole("status").filter({ hasText: /./ })).toHaveText(/^Paid\./);
    await expect(invoicePdf).toHaveAttribute("href", pdfPath("invoice.pdf"));
    await expect(receipt(page)).toHaveCount(0);
    await expect(page.getByText("Checkout closes")).toHaveCount(0);

    await page.clock.runFor(POLL_MS);
    const panel = receipt(page);
    await expect(panel).toContainText(/Amount paid\s*1,250\.00\s*USDC/);
    await expect(panel).toContainText(/Paid\s*Oct 10, 2026, 12:05\sPM/);
    await expect(panel).toContainText(/Settled\s*Oct 10, 2026, 12:20\sPM/);
    const explorer = panel.getByRole("link", { name: "View transaction on Basescan" });
    await expect(explorer).toHaveCount(2);
    for (const [i, [term, hash]] of [
      ["Payment transaction", DEPOSIT.txHash],
      ["Settlement transaction", SETTLED.settlementTxHash],
    ].entries()) {
      await expect(panel).toContainText(`${term}${hash}`);
      await expect(explorer.nth(i)).toHaveAttribute(
        "href",
        `https://sepolia.basescan.org/tx/${hash}`,
      );
      await expect(explorer.nth(i)).toHaveAttribute("target", "_blank");
      await expect(explorer.nth(i)).toHaveAttribute("rel", "noopener noreferrer");
    }
    await expect(panel.getByRole("link", { name: "Download receipt PDF" })).toHaveAttribute(
      "href",
      pdfPath("receipt.pdf"),
    );
    await expect(invoicePdf).toBeVisible();
  });
});
