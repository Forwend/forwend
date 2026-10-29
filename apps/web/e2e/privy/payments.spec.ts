import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { sidewaysScroll } from "../sideways";
import { blockingViolations } from "./axe";
import { activityItem, hash, mockApi, sampleInvoice, sampleTransfer } from "./sample-api";
import { session } from "./session";

const PROFILE = "22222222-2222-2222-2222-222222222222";

/** Picks an option of a list's select menu (Status, Source, Store). */
async function pick(page: Page, menu: string, option: string) {
  await page
    .getByRole("main")
    .getByRole("button", { name: new RegExp(`^${menu}: `) })
    .click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).click();
}
const STORE = "66666666-6666-4666-8666-666666666666";
const OTHER = "77777777-7777-4777-8777-777777777777";
const TOKEN = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const AT = "2026-10-27T06:00:00Z";
const ASSET = { chainId: 84532, token: TOKEN, symbol: "USDC", decimals: 6 };
const amounts = {
  receiver: "2500000",
  payable: "2000000",
  held: "500000",
  settled: "0",
  refunded: "0",
  observedRefunded: "0",
  lastReturnTxHash: null,
  unreconciled: false,
  hasPolicyException: false,
};
const payment = {
  ...ASSET,
  paymentId: hash("a"),
  optionId: hash("a"),
  optionLocked: true,
  optionCount: 1,
  source: "checkout",
  purpose: "checkout",
  documentKind: "none",
  number: null,
  storeId: STORE,
  storeName: "Sample shop",
  linkId: null,
  livemode: false,
  title: "Coffee order 42",
  reference: "order-42",
  customerName: "Mara Ilić",
  customerEmail: "mara@example.com",
  amount: "2000000",
  paymentStatus: "paid",
  settlementStatus: "pending",
  refundStatus: "held",
  confirming: false,
  closed: false,
  createdAt: AT,
  closesAt: "2026-10-28T06:00:00Z",
  hostedUrl: `http://localhost:3000/pay/${"d".repeat(64)}`,
  amounts,
  receipts: [{ ...ASSET, optionId: hash("a"), received: "2500000", pending: "0" }],
};
const other = {
  ...payment,
  paymentId: hash("b"),
  optionId: hash("b"),
  storeId: OTHER,
  storeName: "Other shop",
  title: "Other shop purchase",
  reference: "other-43",
};
const held = {
  amount: "500000",
  asset: ASSET,
  code: "held_funds",
  action: "review_funds",
  optionId: payment.optionId,
  endpointId: null,
  eventId: null,
  reason: "payment_completed",
};
const detail = {
  ...payment,
  snapshotAt: AT,
  customer: { name: "Mara Ilić", email: "mara@example.com" },
  metadata: { order: "42" },
  problems: [held],
  deliveryCount: 1,
  deliveriesTruncated: false,
  options: [
    {
      ...ASSET,
      optionId: payment.optionId,
      amount: payment.amount,
      receiveAddress: `0x${"c".repeat(40)}`,
      closesAt: payment.closesAt,
      paymentStatus: "paid",
      settlementStatus: "pending",
      refundStatus: "held",
      amounts,
      coverage: {
        historyComplete: true,
        verifiedBlock: 100,
        verifiedHash: hash("e"),
        verifiedTime: AT,
        observedBalance: "2500000",
        balanceDifference: "0",
        reconciliationError: null,
        bookingError: null,
        retryAt: null,
        updatedAt: AT,
        chainFinalizedBlock: 100,
        pendingDeposits: 0,
        unbookedDeposits: 0,
        unprovedDeposits: 0,
        unbookedOutflows: 0,
      },
      settlement: {
        status: "pending",
        wait: null,
        attempts: 0,
        createdAt: AT,
        nextAttemptAt: AT,
        signedAt: null,
        txHash: null,
      },
      deposits: [
        {
          txHash: hash("c"),
          logIndex: 0,
          from: `0x${"d".repeat(40)}`,
          amount: "2500000",
          blockNumber: 90,
          blockTime: AT,
          status: "confirmed",
          late: false,
          paid: "2000000",
          blocksLeft: 0,
          blocksTotal: 12,
          secondsLeft: 0,
        },
      ],
      depositsTruncated: false,
    },
  ],
  deliveries: [
    {
      endpointId: STORE,
      eventId: "evt_test",
      eventType: "invoice.paid",
      status: "failed",
      enabled: false,
      attempts: 2,
      lastStatusCode: 503,
      lastAttemptAt: AT,
      nextAttemptAt: AT,
      canManage: true,
    },
  ],
};
const movements = {
  snapshotAt: AT,
  nextCursor: null,
  items: [
    {
      id: "ledger:1",
      state: "booked",
      recordedAt: AT,
      paymentId: payment.paymentId,
      optionId: payment.optionId,
      kind: "deposit",
      ...ASSET,
      sourceAmount: "2500000",
      receiverDelta: "2500000",
      payableDelta: "2000000",
      heldDelta: "500000",
      txHash: hash("c"),
      blockNumber: 90,
      blockHash: hash("e"),
      logIndex: 0,
      transferLogIndex: 0,
      verified: true,
      reconciliationError: null,
    },
  ],
};
const report = {
  snapshotAt: AT,
  from: "1970-01-01T00:00:00Z",
  to: "9999-01-01T00:00:00Z",
  assets: [
    {
      ...ASSET,
      storeId: STORE,
      storeName: "Sample shop",
      livemode: false,
      opening: { receiver: "0", payable: "0", held: "0" },
      changes: { receiver: "2500000", payable: "2000000", held: "500000" },
      closing: { receiver: "2500000", payable: "2000000", held: "500000" },
      settled: "0",
      refunded: "0",
      checkpointBalance: "2500000",
      checkpointDifference: "0",
      receiverCount: 1,
      verifiedReceivers: 1,
      unreconciledReceivers: 0,
      pendingDeposits: 0,
      unbookedDeposits: 0,
      unprovedDeposits: 0,
      unbookedOutflows: 0,
      otherAssetMovements: 0,
      policyExceptions: 0,
      bookedMovements: 1,
      minVerifiedBlock: 100,
      maxVerifiedBlock: 100,
      chainFinalizedBlock: 100,
    },
  ],
};
async function mockPayments(page: Page) {
  await mockApi(page);
  const requested: URL[] = [];
  await page.route(`/api/v1/profiles/${PROFILE}/**`, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.split(`/profiles/${PROFILE}/`)[1];
    if (path === "stores")
      return route.fulfill({
        json: {
          stores: [
            { storeId: STORE, name: "Sample shop" },
            { storeId: OTHER, name: "Other shop" },
          ].map((store) => ({
            ...store,
            defaultExpiresIn: 3600,
            allowedOrigins: [],
            brandColor: null,
            logoAt: null,
            tokensOff: [],
            updatedAt: AT,
          })),
        },
      });
    if (path?.startsWith("payments")) requested.push(url);
    if (path === "payments")
      return route.fulfill({
        json: {
          items: [payment, other].filter(
            (item) =>
              !url.searchParams.get("storeId") || item.storeId === url.searchParams.get("storeId"),
          ),
          nextCursor: null,
        },
      });
    if (path === "payments/attention")
      return route.fulfill({
        json: {
          snapshotAt: AT,
          items: [{ ...payment, problems: [held] }],
          nextCursor: null,
          webhooks: [],
          webhooksTruncated: false,
        },
      });
    if (path === "payments/reconciliation") return route.fulfill({ json: report });
    if (path === `payments/${payment.paymentId}`)
      return route.fulfill({
        json: {
          ...detail,
          optionCount: 300,
          options:
            url.searchParams.get("view") === "summary"
              ? detail.options
              : [
                  ...detail.options,
                  ...Array.from({ length: 299 }, (_, index) => ({
                    ...detail.options[0],
                    optionId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
                    symbol: `TOKEN${index + 1}`,
                    deposits: [],
                    amounts: {
                      ...amounts,
                      receiver: "0",
                      payable: "0",
                      held: "0",
                      unreconciled: true,
                      reconciliationStatus: "pending",
                    },
                    settlement: null,
                  })),
                ],
        },
      });
    if (path === `payments/${payment.paymentId}/movements`)
      return route.fulfill({ json: movements });
    if (path === "payments.csv" || path?.endsWith("/movements.csv"))
      return route.fulfill({
        contentType: "text/csv",
        body: `Payment ID,Receiver delta (base units)\r\n${payment.paymentId},2500000\r\n`,
      });
    return route.fallback();
  });
  return requested;
}

test("merchant separates payment, held funds, delivery and store records", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    storageState: session,
  });
  const page = await context.newPage();
  const requests = await mockPayments(page);
  await page.goto("/app/payments");
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: payment.reference, exact: true })).toBeVisible();
  await page.screenshot({ path: "../../docs/runs/f336-payments-1440.png", fullPage: true });
  await pick(page, "Status", "Confirming");
  await expect
    .poll(() => requests.some((url) => url.searchParams.get("state") === "confirming"))
    .toBe(true);
  await pick(page, "Status", "All");
  await pick(page, "Store", "Other shop");
  await expect(main.getByRole("link", { name: other.reference, exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: payment.reference, exact: true })).toHaveCount(0);
  expect(requests.some((url) => url.searchParams.get("storeId") === OTHER)).toBe(true);
  await pick(page, "Store", "All");
  const attention = main.getByRole("radio", { name: "Needs attention", exact: true });
  await attention.click();
  await expect(attention).toBeChecked();
  await expect(page).toHaveURL(/view=attention/);
  await expect(main.getByRole("link", { name: payment.reference, exact: true })).toBeVisible();
  await main.getByRole("link", { name: payment.reference, exact: true }).click();
  await expect(main.getByRole("heading", { name: payment.reference, exact: true })).toBeVisible();
  // Paid with 0.50 held for the payer reads Overpaid (D-114); the held part is never the merchant's.
  await expect(main.getByText("Overpaid", { exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: /Basescan/ })).toHaveAttribute(
    "href",
    `https://sepolia.basescan.org/tx/${hash("c")}`,
  );
  await expect(main.getByText("0.50", { exact: false }).first()).toBeVisible();
  expect(
    requests.filter(
      (url) => url.pathname.endsWith(payment.paymentId) && !url.searchParams.has("view"),
    ),
  ).toHaveLength(0);
  expect(requests.filter((url) => url.pathname.endsWith("/movements"))).toHaveLength(0);
  await expect(main.getByRole("combobox", { name: "Payment option" })).toHaveCount(0);
  await page.screenshot({ path: "../../docs/runs/f336-payment-detail-1440.png", fullPage: true });
  await main.getByRole("button", { name: "Technical details", exact: true }).click();
  await expect(main.getByRole("combobox", { name: "Payment option" })).toBeVisible();
  expect(requests.filter((url) => url.pathname.endsWith("/movements"))).toHaveLength(0);
  await expect(main.getByText("History checked", { exact: false })).toHaveCount(0);
  await expect(main.getByText("HTTP 503", { exact: false })).toBeVisible();
  await main.getByRole("button", { name: "Technical details", exact: true }).click();
  await expect(main.getByRole("link", { name: /^INV-/ })).toHaveCount(0);
  expect(await blockingViolations(page)).toEqual([]);
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(1);

  await main.getByRole("button", { name: "Export", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV", exact: true }).click();
  const download = await downloading;
  const downloadedPath = await download.path();
  if (!downloadedPath) throw new Error("Download file missing");
  expect(await readFile(downloadedPath, "utf8")).toContain("2500000");
  await context.close();
});

test("payment lists, reconciliation and detail remain usable on a phone", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockPayments(page);
  await page.goto("/app/payments");
  // A phone row's link is its two lines, the payment's label first.
  await expect(
    page.getByRole("main").getByRole("link", { name: new RegExp(`^${payment.reference}\\b`) }),
  ).toBeVisible();
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(1);
  expect(await blockingViolations(page)).toEqual([]);
  await page.screenshot({ path: "../../docs/runs/f336-payments-390.png", fullPage: true });
  const reconciliation = page.getByRole("radio", { name: "Reconciliation", exact: true });
  await reconciliation.click();
  await expect(reconciliation).toBeChecked();
  // The report's account rows show on a phone too.
  await expect(page.getByRole("rowheader", { name: "In payment addresses" }).first()).toBeVisible();
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(1);
  await page.goto(`/app/payments/${payment.paymentId}`);
  await expect(page.getByRole("heading", { name: payment.reference, exact: true })).toBeVisible();
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(1);
  expect(await blockingViolations(page)).toEqual([]);
  await page.screenshot({ path: "../../docs/runs/f336-payment-detail-390.png", fullPage: true });
  await context.close();
});

test("failed store loading blocks invoice creation until an explicit retry succeeds", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: session });
  const page = await context.newPage();
  await mockApi(page);
  let failed = true;
  await page.route(`/api/v1/profiles/${PROFILE}/stores`, (route) =>
    failed
      ? route.fulfill({
          status: 503,
          json: { error: { code: "unavailable", message: "Unavailable" } },
        })
      : route.fulfill({
          json: {
            stores: [
              {
                storeId: STORE,
                name: "Sample shop",
                defaultExpiresIn: 3600,
                allowedOrigins: [],
                brandColor: null,
                logoAt: null,
                tokensOff: [],
                updatedAt: AT,
              },
            ],
          },
        }),
  );
  await page.goto("/app/invoices/new");
  const main = page.getByRole("main");
  await expect(
    main.getByRole("alert").filter({ hasText: "We could not load stores" }),
  ).toBeVisible();
  await expect(main.getByRole("button", { name: "Create invoice", exact: true })).toHaveCount(0);
  failed = false;
  await main.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(main.getByRole("button", { name: "Create invoice", exact: true })).toBeVisible();
  await context.close();
});

test("invalid payment filters cannot broaden a CSV export", async ({ browser }) => {
  const context = await browser.newContext({ storageState: session });
  const page = await context.newPage();
  const requests = await mockPayments(page);
  await page.goto("/app/payments?source=bogus");
  const main = page.getByRole("main");
  await expect(main.getByRole("alert")).toContainText("Unknown payment filter");
  await expect(main.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
  expect(requests.some((url) => url.pathname.endsWith(".csv"))).toBe(false);
  await main.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(main.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
  await expect(main.getByRole("link", { name: payment.reference, exact: true })).toBeVisible();
  await context.close();
});

test("payment tabs poll summaries and leave unused diagnostics unloaded", async ({ browser }) => {
  const windows = await Promise.all(
    Array.from({ length: 3 }, async () => {
      const context = await browser.newContext({ storageState: session });
      const page = await context.newPage();
      const requests = await mockPayments(page);
      await page.goto(`/app/payments/${payment.paymentId}`);
      await expect(
        page.getByRole("heading", { name: payment.reference, exact: true }),
      ).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      return { context, page, requests };
    }),
  );
  const counts = () =>
    windows.map(
      ({ requests }) => requests.filter((url) => url.pathname.endsWith(payment.paymentId)).length,
    );
  const initial = counts();
  await new Promise((resolve) => setTimeout(resolve, 31_000));
  const visible = counts();
  expect(visible).toEqual(initial.map((count) => count + 2));
  for (const { page } of windows)
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      window.dispatchEvent(new Event("visibilitychange"));
    });
  await new Promise((resolve) => setTimeout(resolve, 16_000));
  expect(counts()).toEqual(visible);
  for (const { requests } of windows) {
    expect(
      requests.filter(
        (url) =>
          url.pathname.endsWith(payment.paymentId) && url.searchParams.get("view") !== "summary",
      ),
    ).toHaveLength(0);
    expect(requests.filter((url) => url.pathname.endsWith("/movements"))).toHaveLength(0);
  }
  await Promise.all(windows.map(({ context }) => context.close()));
});

test("a partial payment awaiting evidence does not ask the merchant to collect again", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: session });
  const page = await context.newPage();
  await mockPayments(page);
  await page.route(`**/payments/${payment.paymentId}?view=summary`, (route) =>
    route.fulfill({
      json: {
        ...detail,
        paymentStatus: "partially_paid",
        problems: [{ ...held, code: "partial_payment", action: "wait" }],
      },
    }),
  );
  await page.goto(`/app/payments/${payment.paymentId}`);
  await expect(
    page.getByText("Confirming payment. Do not ask the customer to pay again.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Share checkout for the remaining amount.", { exact: true }),
  ).toHaveCount(0);
  await context.close();
});

test("uncredited payment shows the funded option and pending records", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockPayments(page);
  const empty = {
    ...amounts,
    receiver: "0",
    payable: "0",
    held: "0",
    reconciliationStatus: "pending",
    unreconciled: true,
  };
  const original = detail.options[0];
  if (!original) throw new Error("Missing payment option fixture");
  const unused = { ...original, deposits: [], amounts: empty, settlement: null };
  const funded = {
    ...unused,
    optionId: hash("b"),
    chainId: 42431,
    token: "0x20c0000000000000000000006a37da5c996874be",
    symbol: "OUSD",
    deposits: [{ ...original.deposits[0], amount: "1000000", paid: null, blocksLeft: 0 }],
    coverage: { ...unused.coverage, unbookedDeposits: 1, unprovedDeposits: 1 },
  };
  await page.route(`**/v1/profiles/${PROFILE}/payments/${payment.paymentId}**`, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/movements"))
      return route.fulfill({
        json: {
          ...movements,
          items: [
            {
              ...movements.items[0],
              state: "observed",
              optionId: funded.optionId,
              chainId: funded.chainId,
              token: funded.token,
              symbol: funded.symbol,
              decimals: funded.decimals,
              payableDelta: null,
              heldDelta: null,
              receiverDelta: null,
              sourceAmount: "1000000",
              verified: false,
              reconciliationError: "source_evidence_missing",
            },
          ],
        },
      });
    return route.fulfill({
      json: {
        ...detail,
        snapshotAt: "2026-10-27T06:10:00Z",
        paymentStatus: "detected",
        optionLocked: false,
        optionCount: 2,
        settlementStatus: "none",
        amounts: empty,
        options: [unused, funded],
        receipts: [
          {
            ...ASSET,
            optionId: funded.optionId,
            chainId: funded.chainId,
            token: funded.token,
            symbol: funded.symbol,
            received: "1000000",
            pending: "1000000",
          },
        ],
        problems: [],
        deliveries: [],
      },
    });
  });
  await page.goto(`/app/payments/${payment.paymentId}`);
  const main = page.getByRole("main");
  await expect(main.getByText("Confirming", { exact: true })).toBeVisible();
  await expect(
    main.getByText("Confirmation is delayed. Do not ask the customer to pay again."),
  ).toBeVisible();
  await expect(main.getByText("OUSD ·", { exact: false }).first()).toBeVisible();
  await expect(main.getByText("1.00", { exact: true })).toHaveCount(2);
  await expect(main.getByText("Paid", { exact: true })).toHaveCount(0);
  await expect(main.getByText("Awaiting customer payment", { exact: true })).toHaveCount(0);
  await main.getByRole("button", { name: "Technical details", exact: true }).click();
  await expect(main.getByRole("combobox", { name: "Payment option" })).toContainText("OUSD");
  await main.getByRole("button", { name: "Transactions", exact: true }).click();
  await expect(main.getByRole("table")).toBeVisible();
  await expect(main.getByText("Transfer records incomplete. Contact support.")).toHaveCount(0);
  await expect(main.getByText("Complete", { exact: true })).toHaveCount(0);
  await main.getByRole("button", { name: "Details", exact: true }).first().click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: "../../docs/runs/f336-confirming-390.png", fullPage: true });
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(1);
  await context.close();
});

for (const width of [1440, 390]) {
  test(`the same payment agrees across collection pages at ${width}px`, async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      storageState: session,
    });
    const page = await context.newPage();
    const linkId = "33333333-3333-4333-8333-333333333333";
    const original = detail.options[0];
    if (!original) throw new Error("Missing option");
    for (const state of [
      {
        status: "detected",
        wallet: "none",
        refund: "none",
        amount: "2000000",
        pending: "2000000",
        label: "Confirming",
      },
      {
        status: "partially_paid",
        wallet: "none",
        refund: "none",
        amount: "1000000",
        pending: "0",
        label: "Partially paid",
      },
      {
        status: "paid",
        wallet: "pending",
        refund: "none",
        amount: "2000000",
        pending: "0",
        label: "Paid",
      },
      {
        status: "paid",
        wallet: "settled",
        refund: "none",
        amount: "2000000",
        pending: "0",
        label: "Paid",
      },
      {
        status: "expired",
        wallet: "none",
        refund: "none",
        amount: "0",
        pending: "0",
        label: "Expired",
      },
      {
        status: "expired_partially_paid",
        wallet: "none",
        refund: "refunded",
        amount: "1000000",
        pending: "0",
        label: "Expired, partially paid",
      },
    ]) {
      await page.unrouteAll({ behavior: "wait" });
      const inv = {
        ...sampleInvoice(2, state.status, state.wallet, "Coffee order 42", "Mara Ilić"),
        invoiceId: payment.paymentId,
        optionId: payment.optionId,
        reference: payment.reference,
        closed: state.status.startsWith("expired"),
        confirming: state.pending !== "0",
      };
      const values = {
        ...amounts,
        receiver: state.wallet === "settled" || state.refund === "refunded" ? "0" : state.amount,
        payable:
          state.pending !== "0" || state.refund === "refunded" || state.wallet === "settled"
            ? "0"
            : state.amount,
        held: "0",
        settled: state.wallet === "settled" ? state.amount : "0",
        refunded: state.refund === "refunded" ? state.amount : "0",
      };
      const receipt = {
        ...ASSET,
        optionId: payment.optionId,
        received: state.amount,
        pending: state.pending,
      };
      const row = {
        ...payment,
        paymentStatus: state.status,
        settlementStatus: state.wallet,
        refundStatus: state.refund,
        confirming: inv.confirming,
        closed: inv.closed,
        amounts: values,
        receipts: state.amount === "0" ? [] : [receipt],
        source: "payment_link",
        documentKind: "invoice",
        number: 2,
        linkId,
      };
      await mockApi(page, {
        invoices: [inv],
        activity: [
          {
            ...activityItem(inv, { txHash: hash("c"), status: "confirmed" }),
            paymentStatus: state.status,
            confirming: inv.confirming,
            amount: state.amount,
            closed: inv.closed,
          },
          { ...activityItem(inv), paymentStatus: state.status, confirming: inv.confirming },
        ],
        transfers: [],
      });
      await page.route(`**/v1/profiles/${PROFILE}/payments**`, (route) => {
        const url = new URL(route.request().url());
        return route.fulfill({
          json: url.pathname.endsWith(payment.paymentId)
            ? {
                ...detail,
                ...row,
                customer: { name: row.customerName, email: row.customerEmail },
                problems: [],
                deliveries: [],
                options: [
                  {
                    ...original,
                    paymentStatus: state.status,
                    settlementStatus: state.wallet,
                    refundStatus: state.refund,
                    amounts: values,
                    deposits:
                      state.amount === "0"
                        ? []
                        : [
                            {
                              ...original.deposits[0],
                              amount: state.amount,
                              paid: state.pending === "0" ? state.amount : null,
                            },
                          ],
                  },
                ],
              }
            : { items: [row], nextCursor: null },
        });
      });
      await page.route(`**/v1/profiles/${PROFILE}/stores`, (route) =>
        route.fulfill({ json: { stores: [] } }),
      );
      const offer = {
        linkId,
        slug: "coffeeoffer1",
        storeId: STORE,
        title: "Coffee offer",
        amountUsd: "2.00",
        minUsd: null,
        maxUsd: null,
        endsAt: null,
        maxPayments: null,
        active: true,
        livemode: false,
        visits: 1,
        paid: state.status === "paid" ? 1 : 0,
        reserved: 0,
        ready: true,
        createdAt: AT,
        updatedAt: AT,
      };
      // The list reads every link; the link page reads its own one.
      await page.route(`**/v1/profiles/${PROFILE}/links**`, (route) =>
        route.fulfill({
          json: new URL(route.request().url()).pathname.endsWith(linkId)
            ? offer
            : { links: [offer] },
        }),
      );
      for (const path of ["/app/payments", `/app/links/${linkId}`]) {
        await page.goto(path);
        const main = page.getByRole("main");
        await expect(
          main
            .getByRole("link", { name: new RegExp(`^${payment.reference}\\b`) })
            .filter({ visible: true }),
        ).toHaveAttribute("href", `/app/payments/${payment.paymentId}`);
        await expect(
          main.getByText(state.label, { exact: true }).filter({ visible: true }),
        ).toBeVisible();
        expect(await sidewaysScroll(page)).toBeLessThanOrEqual(1);
      }
      await page.goto(`/app/payments/${payment.paymentId}`);
      await expect(page.getByRole("main").getByText(state.label, { exact: true })).toBeVisible();
      if (state.pending !== "0")
        await expect(
          page
            .getByRole("main")
            .getByText(/confirming$/)
            .filter({ visible: true }),
        ).toBeVisible();
      if (state.refund === "refunded")
        await expect(
          page
            .getByRole("main")
            .getByText(/Returned/)
            .first(),
        ).toBeVisible();
      await expect(page.getByRole("link", { name: "INV-0002", exact: true })).toHaveAttribute(
        "href",
        `/app/invoices/${payment.paymentId}`,
      );
      await page.goto(`/app/invoices/${payment.paymentId}`);
      await expect(
        page
          .getByRole("main")
          .getByText(state.label, { exact: true })
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "View payment", exact: true })).toHaveAttribute(
        "href",
        `/app/payments/${payment.paymentId}`,
      );
      await page.goto("/app/activity");
      await expect(
        page
          .getByRole("main")
          .getByText(state.label, { exact: true })
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
      await expect(page.getByRole("main").getByRole("link", { name: /^Payment/ })).toHaveAttribute(
        "href",
        `/app/payments/${payment.paymentId}`,
      );
      await expect(
        page.getByRole("main").getByRole("link", { name: /^Invoice created/ }),
      ).toHaveAttribute("href", `/app/invoices/${payment.paymentId}`);
      expect(await sidewaysScroll(page)).toBeLessThanOrEqual(1);
    }
    await context.close();
  });
}

test("the bell shows wallet settlement once and keeps an unconfirmed transfer pending", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: session,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const incoming = {
    ...sampleTransfer(0),
    invoice: { invoiceId: payment.paymentId, number: 2, clientName: payment.customerName },
  };
  const pending = { ...sampleTransfer(1), status: "detected" };
  await mockApi(page, {
    invoices: [],
    activity: [],
    transfers: [incoming, pending],
    events: [
      {
        id: 1,
        kind: "invoice.settled",
        invoiceId: payment.paymentId,
        number: null,
        title: payment.reference,
        ...ASSET,
        amount: "2000000",
        at: AT,
      },
    ],
  });
  await page.goto("/app/payments");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const menu = page.getByRole("menu");
  // The settled payment's own event says its money is in the wallet; its transfer is not listed again.
  await expect(menu.getByRole("menuitem").filter({ hasText: /in your wallet/i })).toHaveCount(1);
  await expect(menu.getByRole("menuitem").filter({ hasText: "Confirming" })).toBeVisible();
  await expect(menu.getByRole("menuitem").filter({ hasText: /in your wallet/i })).toHaveAttribute(
    "href",
    `/app/payments/${payment.paymentId}`,
  );
  await context.close();
});

test("transaction evidence distinguishes missing records, recovery and internal changes", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: session,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await mockPayments(page);
  await page.route(`**/payments/${payment.paymentId}/movements*`, (route) =>
    route.fulfill({
      json: {
        ...movements,
        items: [
          {
            ...movements.items[0],
            verified: false,
            reconciliationError: "source_evidence_missing",
          },
          {
            ...movements.items[0],
            id: "outflow:2",
            state: "observed",
            kind: "recovery",
            token: `0x${"b".repeat(40)}`,
            sourceAmount: "1",
            receiverDelta: null,
            payableDelta: null,
            heldDelta: null,
            verified: true,
            reconciliationError: "different_asset",
          },
          {
            ...movements.items[0],
            id: "ledger:3",
            kind: "reopen",
            sourceAmount: null,
            txHash: null,
            verified: false,
            reconciliationError: null,
          },
        ],
      },
    }),
  );
  await page.goto(`/app/payments/${payment.paymentId}`);
  await page.getByRole("button", { name: "Transactions", exact: true }).click();
  const table = page.getByRole("main").getByRole("table");
  await expect(table.getByText("Transfer records incomplete. Contact support.")).toHaveCount(1);
  await expect(table.getByRole("row").filter({ hasText: "Funds returned" })).toContainText(
    "Confirmed",
  );
  await expect(table.getByRole("row").filter({ hasText: "Checkout reopened" })).toContainText(
    "Recorded",
  );
  await table.getByRole("button", { name: "Details", exact: true }).first().click();
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(1);
  await context.close();
});

test("payment detail tracks settlement finality and keeps its transaction link", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    hasTouch: true,
    storageState: session,
  });
  const page = await context.newPage();
  await mockPayments(page);
  const option = detail.options[0];
  const deposit = option?.deposits[0];
  if (!option || !deposit) throw new Error("Payment fixture requires an option and deposit");
  let blocksLeft = 375;
  let settled = false;
  const txHash = hash("9");
  await page.route(`**/payments/${payment.paymentId}?view=summary`, (route) =>
    route.fulfill({
      json: {
        ...detail,
        settlementStatus: settled ? "settled" : "pending",
        problems: [
          ...detail.problems,
          ...["outflow_unreconciled", "settlement_delayed"].map((code) => ({
            ...held,
            code,
            action: "wait",
            amount: null,
          })),
        ],
        options: [
          {
            ...option,
            settlementStatus: settled ? "settled" : "pending",
            deposits: [
              {
                ...deposit,
                status: "detected",
                blocksLeft: 590,
                blocksTotal: 599,
                secondsLeft: 40,
              },
            ],
            settlement: {
              ...option.settlement,
              status: settled ? "confirmed" : "sent",
              txHash: settled ? hash("8") : txHash,
              receiptTxHash: txHash,
              blockNumber: 1200,
              blocksLeft,
              secondsLeft: blocksLeft * 2,
            },
          },
        ],
      },
    }),
  );
  await page.goto(`/app/payments/${payment.paymentId}`);
  const transfer = page.getByRole("region", { name: "Transfer to your wallet" });
  await expect(transfer.getByRole("status")).toHaveText("Confirming");
  const estimate = transfer.getByRole("button", {
    name: "375 blocks remaining · About 13 min left",
  });
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await estimate.hover();
  await expect(page.getByRole("tooltip")).toContainText("375 blocks remaining · About 13 min left");
  await page.mouse.move(0, 0);
  await estimate.focus();
  await expect(page.getByRole("tooltip")).toContainText("375 blocks remaining · About 13 min left");
  await page.keyboard.press("Escape");
  await estimate.blur();
  await expect(page.getByText("Outgoing transfer not yet confirmed")).toHaveCount(0);
  await expect(page.getByText("Settlement delayed", { exact: true })).toHaveCount(0);
  await expect(page.getByText("This money is owed to the payer.", { exact: false })).toBeVisible();
  await expect(transfer.getByRole("link")).toHaveAttribute(
    "href",
    `https://sepolia.basescan.org/tx/${txHash}`,
  );
  await expect(page.getByText("Confirming (9/599)", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("main").locator(`a[href="https://sepolia.basescan.org/tx/${deposit.txHash}"]`),
  ).toHaveCount(1);
  await page.screenshot({
    path: "../../docs/runs/f337-settlement-progress-1440.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(transfer).toBeVisible();
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(1);
  expect(await blockingViolations(page)).toEqual([]);
  await page.screenshot({
    path: "../../docs/runs/f337-settlement-progress-390.png",
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await transfer.getByRole("button", { name: "375 blocks remaining · About 13 min left" }).tap();
  await expect(page.getByRole("tooltip")).toContainText("375 blocks remaining · About 13 min left");
  expect(await blockingViolations(page)).toEqual([]);
  await page.screenshot({
    path: "../../docs/runs/f337-confirmation-tooltip-dark-390.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  blocksLeft = 125;
  await page.reload();
  await expect(transfer.getByRole("status")).toHaveText("Confirming");
  await expect(
    transfer.getByRole("button", { name: "125 blocks remaining · About 5 min left" }),
  ).toBeVisible();
  blocksLeft = 0;
  await page.reload();
  await expect(transfer.getByRole("status")).toHaveText("Confirming");
  await expect(transfer).not.toContainText("In your wallet");
  settled = true;
  await page.reload();
  await expect(transfer).toContainText("In your wallet");
  await expect(transfer.getByRole("link")).toHaveAttribute(
    "href",
    `https://sepolia.basescan.org/tx/${hash("8")}`,
  );
  await context.close();
});
