import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { sidewaysScroll } from "../sideways";
import { blockingViolations } from "./axe";
import { hash, mockApi } from "./sample-api";
import { session } from "./session";

const PROFILE = "22222222-2222-2222-2222-222222222222";
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
};
const other = {
  ...payment,
  paymentId: hash("b"),
  optionId: hash("b"),
  storeId: OTHER,
  storeName: "Other shop",
  title: "Other shop purchase",
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
      deposits: [],
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
    if (path === `payments/${payment.paymentId}`) return route.fulfill({ json: detail });
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
  await expect(main.getByRole("link", { name: payment.title, exact: true })).toBeVisible();
  await main.getByRole("combobox", { name: "Store", exact: true }).click();
  await page.getByRole("option", { name: "Other shop", exact: true }).click();
  await expect(main.getByRole("link", { name: other.title, exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: payment.title, exact: true })).toHaveCount(0);
  expect(requests.some((url) => url.searchParams.get("storeId") === OTHER)).toBe(true);
  await main.getByRole("combobox", { name: "Store", exact: true }).click();
  await page.getByRole("option", { name: "All permitted stores", exact: true }).click();
  const attention = main.getByRole("radio", { name: "Needs attention", exact: true });
  await attention.click();
  await expect(attention).toBeChecked();
  await expect(page).toHaveURL(/view=attention/);
  await expect(
    main.getByRole("table").getByText("Funds held for the payer", { exact: false }),
  ).toBeVisible();
  await main.getByRole("link", { name: payment.title, exact: true }).click();
  await expect(main.getByRole("heading", { name: "Paid", exact: true })).toBeVisible();
  await expect(main.getByText("Held for payer", { exact: true }).locator("..")).toContainText(
    "0.50",
  );
  await expect(main.getByText("Owed to merchant", { exact: true }).locator("..")).toContainText(
    "2.00",
  );
  await expect(main.getByText("failed · endpoint off", { exact: false })).toBeVisible();
  await expect(main.getByText("2 attempts · HTTP 503")).toBeVisible();
  await expect(main.getByRole("link", { name: "View invoice", exact: true })).toHaveCount(0);
  expect(await blockingViolations(page)).toEqual([]);
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "../../docs/runs/f331-payment-detail-1440.png", fullPage: true });
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
  await expect(
    page.getByRole("main").getByRole("link", { name: payment.title, exact: true }),
  ).toBeVisible();
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(1);
  expect(await blockingViolations(page)).toEqual([]);
  await page.screenshot({ path: "../../docs/runs/f331-payments-390.png", fullPage: true });
  const reconciliation = page.getByRole("radio", { name: "Reconciliation", exact: true });
  await reconciliation.click();
  await expect(reconciliation).toBeChecked();
  await expect(page.getByText("In receive contracts", { exact: true })).toBeVisible();
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(1);
  await page.goto(`/app/payments/${payment.paymentId}`);
  await expect(page.getByRole("heading", { name: payment.title, exact: true })).toBeVisible();
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(1);
  expect(await blockingViolations(page)).toEqual([]);
  await page.screenshot({ path: "../../docs/runs/f331-payment-detail-390.png", fullPage: true });
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
  await expect(main.getByRole("link", { name: payment.title, exact: true })).toBeVisible();
  await context.close();
});
