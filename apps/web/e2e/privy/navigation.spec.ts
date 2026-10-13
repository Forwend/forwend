import { expect, test } from "@playwright/test";
import { blockingViolations } from "./axe";
import {
  activityItem,
  CONFIRMING_INVOICE,
  hash,
  mockApi,
  OPEN_INVOICE,
  SETTLED_INVOICE,
  sampleInvoice,
  sampleTransfer,
} from "./sample-api";
import { session } from "./session";

test("app pages navigate from the breadcrumb and rows, filter and search, link to the explorer, and keep the sidebar fixed", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  const sidebar = page.locator("aside");
  const crumbs = page.getByRole("banner").getByRole("navigation", { name: "Breadcrumb" });
  const main = page.getByRole("main");
  const basescan = (txHash: string) => `https://sepolia.basescan.org/tx/${txHash}`;
  // The page's name is the breadcrumb's: the heading stays for screen readers only.
  const hiddenHeading = async (name: string) => {
    const heading = page.getByRole("heading", { level: 1, name });
    await expect(heading).toBeAttached();
    expect((await heading.boundingBox())?.width).toBeLessThanOrEqual(1);
  };

  // Invoices: status filter and search in the toolbar.
  await page.goto("/app/invoices");
  await expect(crumbs.getByRole("link", { name: "Invoices" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await hiddenHeading("Invoices");
  const rows = main.getByRole("row").filter({ hasText: "INV-" });
  await expect(rows).toHaveCount(4);
  const status = main.getByRole("group", { name: "Status" });
  await status.getByText("Settled", { exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("INV-0003");
  await status.getByText("Open", { exact: true }).click();
  await expect(rows).toHaveCount(2);
  const search = main.getByRole("searchbox", { name: "Search invoices" });
  await search.fill("brightline");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("INV-0004");
  await status.getByText("All", { exact: true }).click();
  await search.fill("inv-0001");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Expired");
  await search.fill("");
  expect(await blockingViolations(page)).toEqual([]);

  // A row opens its invoice; the breadcrumb ends at its number and leads back, with no separate back link.
  await rows.filter({ hasText: "INV-0004" }).click();
  await expect(page).toHaveURL(`/app/invoices/${CONFIRMING_INVOICE.invoiceId}`);
  await expect(crumbs.getByRole("link", { name: "INV-0004" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await hiddenHeading("INV-0004");
  await expect(main.getByRole("link", { name: "Invoices" })).toHaveCount(0);
  await expect(main.getByRole("region", { name: "Billed to" })).toContainText("Brightline Studio");
  // A payment on its way: pending, a short line, and its transaction on Basescan.
  await expect(main.getByRole("status").filter({ hasText: /./ })).toHaveText(
    "Confirming (0/120) · about 6 min left",
  );
  // The timeline carries the invoice's status, at its Confirming step; the payment repeats no pill of its own (R-69).
  const amountPanel = main.getByRole("region", { name: "Amount" });
  await expect(amountPanel.locator("[data-status]")).toHaveCount(0);
  await expect(
    amountPanel
      .getByRole("list", { name: "Payment progress" })
      .getByRole("listitem")
      .filter({ hasText: "Confirming" }),
  ).toHaveAttribute("aria-current", "step");
  const payment = main.getByRole("link", { name: "View transaction on Basescan" });
  await expect(payment).toHaveAttribute("href", basescan(hash("d")));
  await expect(payment).toHaveAttribute("target", "_blank");
  const paymentRow = main
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: "View transaction on Basescan" }) });
  await expect(paymentRow.getByRole("button", { name: `0x${"c".repeat(40)}` })).toHaveText(
    "0xcccc…cccc",
  );
  await expect(paymentRow.locator("time")).toHaveAttribute("datetime", "2026-10-09T08:30:00Z");
  expect(await blockingViolations(page)).toEqual([]);
  await crumbs.getByRole("link", { name: "Invoices" }).click();
  await expect(page).toHaveURL("/app/invoices");
  await crumbs.getByRole("link", { name: "Merchant · Sample shop" }).click();
  await expect(page).toHaveURL("/app");

  // Activity: every row opens its invoice, a payment also links to its transaction; filter and search.
  await sidebar.getByRole("link", { name: "Activity" }).click();
  await hiddenHeading("Activity");
  const items = main.getByRole("listitem");
  await expect(items).toHaveCount(6);
  await expect(
    items.first().getByRole("link", { name: "View transaction on Basescan" }),
  ).toHaveAttribute("href", basescan(hash("d")));
  const activityStatus = main.getByRole("group", { name: "Status" });
  await activityStatus.getByText("Paid", { exact: true }).click();
  await expect(items).toHaveCount(1);
  await expect(items).toContainText("Confirmed");
  await activityStatus.getByText("All", { exact: true }).click();
  await main.getByRole("searchbox", { name: "Search activity" }).fill(hash("e").slice(0, 10));
  await expect(items).toHaveCount(1);
  expect(await blockingViolations(page)).toEqual([]);
  await items.getByRole("link", { name: "Payment" }).click();
  await expect(page).toHaveURL(`/app/invoices/${SETTLED_INVOICE.invoiceId}`);
  await page.goBack();
  await main.getByRole("searchbox", { name: "Search activity" }).fill("");
  await items
    .filter({ hasText: "Waiting for payment" })
    .getByRole("link", { name: "Invoice" })
    .click();
  await expect(page).toHaveURL(`/app/invoices/${OPEN_INVOICE.invoiceId}`);

  // Transactions: each transfer links to its transaction.
  await sidebar.getByRole("link", { name: "Transactions" }).click();
  await hiddenHeading("Transactions");
  await expect(
    main.getByRole("table").getByRole("link", { name: "View transaction on Basescan" }).first(),
  ).toHaveAttribute("href", basescan(`0x00${"9".repeat(62)}`));
  expect(await blockingViolations(page)).toEqual([]);

  // The sidebar stays in view down to the bottom of a long page, open and collapsed, and nothing runs on below the
  // content (a year of chart data once did).
  await sidebar.getByRole("link", { name: "Overview", exact: true }).click();
  await main.getByRole("group", { name: "Chart range" }).getByText("1Y", { exact: true }).click();
  await expect(main.getByRole("img", { name: /^Received/ })).toBeVisible();
  for (const collapse of [false, true]) {
    if (collapse) await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const box = await sidebar.boundingBox();
    expect(box).toMatchObject({ x: 0, y: 0, height: 900, width: collapse ? 64 : 256 });
    const below = await page.evaluate(
      () =>
        document.documentElement.scrollHeight -
        (document.querySelector("main")?.getBoundingClientRect().bottom ?? 0) -
        window.scrollY,
    );
    expect(below).toBeLessThanOrEqual(1);
  }
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await context.close();

  // A phone: the filters and rows fit without sideways scrolling, and the invoice has its back link.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    storageState: session,
  });
  const small = await phone.newPage();
  await mockApi(small);
  for (const path of ["/app/invoices", "/app/activity", "/app/transactions"]) {
    await small.goto(path);
    await expect(small.getByRole("main").getByRole("searchbox")).toBeVisible();
    expect(await small.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  }
  await small.goto(`/app/invoices/${CONFIRMING_INVOICE.invoiceId}`);
  await expect(small.getByRole("heading", { level: 1, name: "INV-0004" })).toBeVisible();
  await expect(small.getByRole("main").getByRole("link", { name: "Invoices" })).toBeVisible();
  expect(await small.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(await blockingViolations(small)).toEqual([]);
  await phone.close();
});

// Lists longer than a page (20 rows); each search's one match sits on the third page.
const LONG_INVOICES = Array.from({ length: 45 }, (_, i) =>
  sampleInvoice(45 - i, "open", "none", i === 42 ? "Zephyr retainer" : "Monthly work", null),
);
const PAST_PAGE_DEPOSIT = hash("7");
const LONG_ACTIVITY = LONG_INVOICES.map((inv) => activityItem(inv));
LONG_ACTIVITY.splice(
  40,
  0,
  activityItem(sampleInvoice(5, "open", "none", "Monthly work", null), {
    txHash: PAST_PAGE_DEPOSIT,
    status: "confirmed",
  }),
);
const PAST_PAGE_PARTY = `0x${"f".repeat(40)}`;
const LONG_TRANSFERS = Array.from({ length: 45 }, (_, i) => ({
  ...sampleTransfer(i),
  direction: "in",
  ...(i === 40 ? { counterparty: PAST_PAGE_PARTY } : {}),
}));

test("Invoices, Activity and Transactions filter and search on the API: a match past the first page shows, and the URL keeps them", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page, {
    invoices: LONG_INVOICES,
    activity: LONG_ACTIVITY,
    transfers: LONG_TRANSFERS,
  });
  const searched: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const q = url.searchParams.get("q");
    if (q && url.pathname.startsWith("/api/v1/profiles/")) searched.push(q);
  });
  const main = page.getByRole("main");

  // Invoices: INV-0003 is the 43rd invoice. Typing sends one request, after the last key.
  await page.goto("/app/invoices");
  const rows = main.getByRole("row").filter({ hasText: "INV-" });
  await expect(rows).toHaveCount(20);
  const invoiceSearch = main.getByRole("searchbox", { name: "Search invoices" });
  await invoiceSearch.pressSequentially("zephyr", { delay: 50 });
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("INV-0003");
  await expect(page).toHaveURL("/app/invoices?q=zephyr");
  expect(searched).toEqual(["zephyr"]);
  await page.reload();
  await expect(invoiceSearch).toHaveValue("zephyr");
  await expect(rows).toHaveCount(1);
  // A filter joins the search in the URL; nothing matched says so and offers to clear both.
  await main.getByRole("group", { name: "Status" }).getByText("Paid", { exact: true }).click();
  await expect(page).toHaveURL("/app/invoices?q=zephyr&status=paid");
  await expect(main.getByText("Nothing matches", { exact: true })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  await main.getByRole("button", { name: "Clear filter and search" }).click();
  await expect(page).toHaveURL("/app/invoices");
  await expect(invoiceSearch).toHaveValue("");
  await expect(rows).toHaveCount(20);
  // "Show more" continues the searched list, and Back from an invoice returns to it.
  await invoiceSearch.fill("monthly");
  await expect(page).toHaveURL("/app/invoices?q=monthly");
  await main.getByRole("button", { name: "Show more" }).click();
  await expect(rows).toHaveCount(40);
  await rows.first().getByRole("link").click();
  await expect(page).toHaveURL(`/app/invoices/${LONG_INVOICES[0]?.invoiceId}`);
  await page.goBack();
  await expect(page).toHaveURL("/app/invoices?q=monthly");
  await expect(invoiceSearch).toHaveValue("monthly");

  // Activity: the payment is the 41st item.
  await page.goto("/app/activity");
  const items = main.getByRole("listitem");
  await expect(items).toHaveCount(20);
  await main
    .getByRole("searchbox", { name: "Search activity" })
    .fill(PAST_PAGE_DEPOSIT.slice(0, 12));
  await expect(items).toHaveCount(1);
  await expect(items).toContainText("Payment");
  await main.getByRole("group", { name: "Status" }).getByText("Paid", { exact: true }).click();
  await expect(page).toHaveURL(`/app/activity?q=${PAST_PAGE_DEPOSIT.slice(0, 12)}&status=paid`);
  await page.reload();
  await expect(items).toHaveCount(1);
  await expect(main.getByRole("searchbox", { name: "Search activity" })).toHaveValue(
    PAST_PAGE_DEPOSIT.slice(0, 12),
  );

  // Transactions, opened with a search as ⌘K and notifications link it: the 41st transfer.
  await page.goto(`/app/transactions?q=${PAST_PAGE_PARTY}`);
  const transfers = main.getByRole("table").locator("tbody tr");
  await expect(transfers).toHaveCount(1);
  await expect(main.getByRole("searchbox", { name: "Search transactions" })).toHaveValue(
    PAST_PAGE_PARTY,
  );
  await main.getByRole("group", { name: "Direction" }).getByText("Out", { exact: true }).click();
  await expect(page).toHaveURL(`/app/transactions?q=${PAST_PAGE_PARTY}&direction=out`);
  await expect(main.getByText("Nothing matches", { exact: true })).toBeVisible();
  await page.reload();
  await expect(main.getByText("Nothing matches", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Clear filter and search" }).click();
  await expect(transfers).toHaveCount(20);
  await context.close();
});

// R-54: a paid invoice whose settle waits to be final says so on its page, with the chain and the time left.
test("a paid invoice that is still settling says why its money waits", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  const paid = {
    ...SETTLED_INVOICE,
    settlementStatus: "none",
    settlementTxHash: null,
    deposits: [],
  };
  const wait = { kind: "finalizing", until: null, secondsLeft: 720 };
  await page.route(`/api/v1/invoices/${paid.invoiceId}`, (route) => route.fulfill({ json: paid }));
  await page.route(`/api/v1/profiles/*/invoices/${paid.invoiceId}`, (route) =>
    route.fulfill({ json: { ...paid, settlementWait: wait } }),
  );
  await page.goto(`/app/invoices/${paid.invoiceId}`);
  await expect(
    page
      .getByRole("main")
      .getByRole("status")
      .filter({ hasText: /^Sending/ }),
  ).toHaveText("Sending to your wallet · waiting for Base Sepolia to finalize, about 12 min left");
  expect(await blockingViolations(page)).toEqual([]);
  await context.close();
});

// R-55: the owner can press Check status on an open invoice's page; a settled invoice has nothing left to check.
test("an open invoice's page offers Check status and a settled one does not", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  await page.route(`/api/v1/invoices/${OPEN_INVOICE.invoiceId}/recheck`, (route) =>
    route.fulfill({
      json: {
        onChain: "0",
        recorded: "0",
        rescanning: false,
        nextCheckAt: new Date(Date.now() + 30_000).toISOString(),
        unreadable: [],
      },
    }),
  );
  await page.goto(`/app/invoices/${OPEN_INVOICE.invoiceId}`);
  const check = page.getByRole("button", { name: "Check status" });
  await check.click();
  await expect(
    page
      .getByRole("main")
      .getByRole("status")
      .filter({ hasText: /^Nothing/ }),
  ).toHaveText("Nothing on Base Sepolia yet.");
  await expect(check).toBeDisabled();
  await page.goto(`/app/invoices/${SETTLED_INVOICE.invoiceId}`);
  await expect(page.getByRole("main").getByText("October retainer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check status" })).toHaveCount(0);
  await context.close();
});

// R-64: clickable rows share their hover and press; Transactions keeps Export at the toolbar's right end, shows each
// network's logo and links the other side's address to the explorer.
test("money tables share row hover, show network logos, keep Export at the right and link counterparties", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  const main = page.getByRole("main");
  const hoverOf = async (row: import("@playwright/test").Locator) => {
    await page.mouse.move(0, 0);
    const before = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
    await row.hover();
    await expect
      .poll(() => row.evaluate((el) => getComputedStyle(el).backgroundColor))
      .not.toBe(before);
    return row.evaluate((el) => getComputedStyle(el).backgroundColor);
  };
  await page.goto("/app/invoices");
  const invoiceHover = await hoverOf(main.locator("tbody tr").first());
  await page.goto("/app/activity");
  const activityHover = await hoverOf(main.getByRole("listitem").first());
  expect(invoiceHover).toBe(activityHover);

  await page.goto("/app/transactions");
  const exportButton = main.getByRole("button", { name: "Export CSV" });
  const search = main.getByRole("searchbox", { name: "Search transactions" });
  const [exportBox, searchBox, mainBox] = await Promise.all([
    exportButton.boundingBox(),
    search.boundingBox(),
    main.locator("table").boundingBox(),
  ]);
  expect(exportBox && searchBox && mainBox).toBeTruthy();
  // Export ends where the table ends, to the right of the search.
  expect(
    Math.abs(
      (exportBox?.x ?? 0) + (exportBox?.width ?? 0) - ((mainBox?.x ?? 0) + (mainBox?.width ?? 0)),
    ),
  ).toBeLessThan(2);
  expect(exportBox?.x ?? 0).toBeGreaterThan(searchBox?.x ?? 0);

  const firstRow = main.locator("tbody tr").first();
  await expect(firstRow.locator("svg").first()).toBeVisible(); // the network's logo
  const counterparty = firstRow.getByRole("link", { name: /on Basescan \(opens in a new tab\)$/ });
  await expect(counterparty).toHaveAttribute(
    "href",
    /^https:\/\/sepolia\.basescan\.org\/address\/0x[0-9a-f]{40}$/,
  );
  await expect(counterparty).toHaveAttribute("target", "_blank");
  await context.close();
});

// R-69: the owner's invoice page says its state once: a tinted badge, a moving current step, payments without
// repeated statuses, and received X of Y when partly paid.
test("the owner's invoice page shows each state once, with the waiting step moving", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  let body: object = OPEN_INVOICE;
  await page.route(
    (url) =>
      url.pathname.startsWith("/api/") &&
      url.pathname.endsWith(`/invoices/${OPEN_INVOICE.invoiceId}`),
    (route) => route.fulfill({ json: body }),
  );
  const deposit = (status: string, amount: string, blocksLeft: number) => ({
    txHash: hash("9"),
    logIndex: 0,
    from: `0x${"c".repeat(40)}`,
    amount,
    blockNumber: 1000,
    blockTime: "2026-10-09T08:30:00Z",
    status,
    late: false,
    blocksLeft,
    blocksTotal: 120,
    secondsLeft: blocksLeft * 3,
  });
  const main = page.getByRole("main");
  const progress = main.getByRole("list", { name: "Payment progress" });
  const current = progress.locator("[aria-current=step]");
  const payments = main.locator("ul").filter({ hasText: "From" });
  // A reload signs in again and redraws the shell: under the full suite's load that can take longer than one check
  // waits, so each state waits for the page itself first.
  const shown = () => expect(progress).toBeVisible({ timeout: 15_000 });

  // Before any money: Waiting is the moving step, and the pay link sits in the header with Copy and Open (R-69, R-60).
  body = { ...OPEN_INVOICE, deposits: [] };
  await page.goto(`/app/invoices/${OPEN_INVOICE.invoiceId}`);
  await expect(progress.getByRole("listitem")).toHaveText([
    /^Waiting/,
    /^Detected/,
    /^Confirming/,
    /^Paid/,
    /^Settled/,
  ]);
  await expect(current).toHaveText("Waiting");
  await expect(current.locator("[class*='fw-progress']")).toHaveCount(1);
  const payLink = main.locator("header").getByRole("region", { name: "Pay link" });
  await expect(payLink.locator("p[title]")).toHaveAttribute(
    "title",
    `http://localhost:3000/pay/${OPEN_INVOICE.invoiceId}`,
  );
  await expect(payLink.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(payLink.getByRole("link", { name: /Open the pay page/ })).toBeVisible();
  await expect(main.getByRole("button", { name: "Check status" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  // Confirming: the count says it once; the payment row has no status pill of its own.
  body = {
    ...OPEN_INVOICE,
    paymentStatus: "detected",
    deposits: [deposit("detected", OPEN_INVOICE.amount, 120)],
  };
  await page.reload();
  await shown();
  await expect(main.getByRole("status").filter({ hasText: /^Confirming/ })).toHaveText(
    "Confirming (0/120) · about 6 min left",
  );
  // The step carries the count with the time behind its clock; the line under it only reads it out (R-69).
  await expect(current).toHaveText("Confirming (0/120)");
  await expect(current.getByRole("button", { name: "About 6 min left" })).toBeVisible();
  await expect(main.getByRole("status").filter({ hasText: /^Confirming/ })).toHaveClass(/sr-only/);
  await expect(payments.locator("[data-status]")).toHaveCount(0);
  await expect(main.getByText(/test network|no real value/i)).toHaveCount(0); // R-72
  expect(await blockingViolations(page)).toEqual([]);
  // A reload halfway keeps the count: the API says how many blocks it had to wait (R-73).
  body = {
    ...OPEN_INVOICE,
    paymentStatus: "detected",
    deposits: [deposit("detected", OPEN_INVOICE.amount, 60)],
  };
  await page.reload();
  await shown();
  await expect(main.getByRole("status").filter({ hasText: /^Confirming/ })).toHaveText(
    "Confirming (60/120) · about 3 min left",
  );

  // Partly paid: the Paid step itself says so, tinted and half full, and the amount says what came in.
  body = {
    ...OPEN_INVOICE,
    paymentStatus: "partially_paid",
    deposits: [deposit("confirmed", "1000000", 0)],
  };
  await page.reload();
  await shown();
  await expect(current).toContainText("Partially paid");
  await expect(progress.getByText("Partially paid")).toHaveClass(/bg-warning-soft/);
  await expect(main.getByText("Received 1.00 USDC of 2.00 USDC")).toBeVisible();
  // No separate line repeats it under the steps.
  await expect(main.getByRole("status").filter({ hasText: "Partially paid" })).toHaveCount(0);
  expect(await blockingViolations(page)).toEqual([]);

  // Partly paid with the next payment still confirming: one state at a time, the confirming one (R-69).
  body = {
    ...OPEN_INVOICE,
    paymentStatus: "partially_paid",
    confirming: true,
    deposits: [
      deposit("confirmed", "1000000", 0),
      { ...deposit("detected", "1000000", 60), logIndex: 1 },
    ],
  };
  await page.reload();
  await shown();
  await expect(main.locator("header [data-status]")).toHaveText("Detected");
  await expect(current).toHaveText("Confirming (60/120)");
  await expect(progress.getByText("Partially paid")).toHaveCount(0);

  // Paid and on its way to the wallet: Paid out (Settled) is the moving step, not an empty one.
  body = {
    ...OPEN_INVOICE,
    paymentStatus: "paid",
    settlementStatus: "pending",
    paidAt: "2026-10-09T08:31:00Z",
    deposits: [deposit("confirmed", OPEN_INVOICE.amount, 0)],
  };
  await page.reload();
  await shown();
  await expect(current).toHaveText("Settled");
  await expect(progress.getByRole("listitem").nth(2)).toHaveText(/^Confirmed/);
  await expect(current.locator("[class*='fw-progress']")).toHaveCount(1);
  await expect(main.getByRole("button", { name: "Check status" })).toHaveCount(0);
  // Paid takes no more money: the pay link is gone.
  await expect(main.getByRole("region", { name: "Pay link" })).toHaveCount(0);

  // Settled: one Transactions list holds the payment and the settlement to the wallet; Details repeats neither (R-69).
  const settleTx = hash("5");
  body = {
    ...OPEN_INVOICE,
    paymentStatus: "paid",
    settlementStatus: "settled",
    paidAt: "2026-10-09T08:31:00Z",
    settledAt: "2026-10-09T08:40:00Z",
    settlementTxHash: settleTx,
    deposits: [deposit("confirmed", OPEN_INVOICE.amount, 0)],
  };
  await page.reload();
  await shown();
  const transactions = main.locator("ul").filter({ hasText: "Settlement" });
  await expect(main.getByText("Transactions", { exact: true })).toBeVisible();
  await expect(transactions.getByRole("listitem")).toHaveText([/^Payment/, /^Settlement/]);
  const settlementRow = transactions.getByRole("listitem").nth(1);
  await expect(settlementRow).toContainText("2.00 USDC");
  await expect(settlementRow.getByRole("link", { name: /Basescan/ })).toHaveAttribute(
    "href",
    `https://sepolia.basescan.org/tx/${settleTx}`,
  );
  await expect(main.getByRole("region", { name: "Details" })).not.toContainText("Settlement");
  expect(await blockingViolations(page)).toEqual([]);

  // Closed takes no more money either: nothing to check (R-69).
  body = { ...OPEN_INVOICE, paymentStatus: "expired", deposits: [] };
  await page.reload();
  await shown();
  await expect(main.locator("header [data-status]")).toHaveText("Expired");
  await expect(main.getByRole("button", { name: "Check status" })).toHaveCount(0);
  await context.close();
});

// R-70: an invoice the client may pay with any stablecoin reads in USD with Any network in the list, chosen or not.
test("the invoice list and activity show a client-chooses invoice in USD with Any network", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  const any = {
    ...sampleInvoice(9, "paid", "pending", "Any network work", "Kettle & Co."),
    optionCount: 4,
  };
  // Partly paid with the next payment confirming reads as confirming in the list too (R-69).
  const partlyConfirming = {
    ...sampleInvoice(7, "partially_paid", "none", "Second half on its way", "Kettle & Co."),
    confirming: true,
  };
  await mockApi(page, {
    invoices: [any, OPEN_INVOICE, partlyConfirming],
    activity: [activityItem(any), activityItem(OPEN_INVOICE)],
    transfers: [],
  });
  await page.goto("/app/invoices");
  const row = page.getByRole("row").filter({ hasText: "INV-0009" });
  await expect(row).toContainText("Any network");
  await expect(row).toContainText("9.00 USD");
  await expect(row).not.toContainText("USDC");
  await expect(
    page.getByRole("row").filter({ hasText: "INV-0007" }).locator("[data-status]"),
  ).toHaveText("Detected");
  const fixed = page.getByRole("row").filter({ hasText: "INV-0002" });
  await expect(fixed).toContainText("USDC");
  await expect(fixed).toContainText("Base Sepolia");

  // Activity reads it the same way, never as its first option's token.
  await page.goto("/app/activity");
  const rows = page.getByRole("main").getByRole("listitem");
  await expect(rows.first()).toContainText("Any network");
  await expect(rows.first()).toContainText("9.00 USD");
  await expect(rows.first()).not.toContainText("USDC");
  await expect(rows.nth(1)).toContainText("Base Sepolia");
  await expect(rows.nth(1)).toContainText("USDC");
  await context.close();
});

// R-74: a chart follows its panel as the window shrinks; it never holds the page at its old width.
test("the overview chart shrinks with the window and the page never scrolls sideways", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  await page.goto("/app");
  const panel = page.getByRole("region", { name: "Received" });
  const chart = panel.getByRole("img");
  await expect(chart).toBeVisible();
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.scrollingElement?.scrollWidth))
      .toBe(width);
    const [inner, outer] = await Promise.all([chart.boundingBox(), panel.boundingBox()]);
    expect(inner && outer && inner.width < outer.width).toBe(true);
  }
  await context.close();
});

// R-76: another profile starts at its own overview, from any page; on phones the tab bar's Profiles switches, so the
// overview has no profile pill.
test("switching profile opens the new profile's overview", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  const sidebar = page.locator("aside");
  // The account may hold several merchant profiles: the first of a kind will do.
  const switchTo = async (kind: string) => {
    await sidebar.getByRole("button", { name: /^Switch profile/ }).click();
    await page
      .getByRole("menuitemradio", { name: new RegExp(`^${kind}`) })
      .first()
      .click();
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(
      sidebar.getByRole("button", { name: new RegExp(`^Switch profile: ${kind}`) }),
    ).toBeVisible();
  };
  // Loaded and hydrated before the menu is used.
  await page.goto("/app/balances", { waitUntil: "networkidle" });
  const start =
    (await sidebar.getByRole("button", { name: /^Switch profile/ }).textContent()) ?? "";
  await switchTo(start.includes("Personal") ? "Merchant" : "Personal");
  await expect(page).toHaveURL("/app");

  await switchTo("Personal");
  await page.goto("/app/invoices", { waitUntil: "networkidle" });
  const first = page.getByRole("main").getByRole("link", { name: /^INV-/ }).first();
  // The test account's personal profile has requests once the request test has run.
  if (await first.count()) {
    await first.click();
    await expect(page).toHaveURL(/\/app\/invoices\/0x/);
    await switchTo("Merchant");
    await expect(page).toHaveURL("/app");
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("main").getByRole("button", { name: /Merchant|Personal/ }),
  ).toHaveCount(0);
  await context.close();
});

// R-75: an empty list, or one filtered to nothing, says so in one centered block that fills the list's width.
test("empty and filtered-out lists say so in one centered block with an icon", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page, { invoices: [], activity: [], transfers: [] });
  const main = page.getByRole("main");
  const fills = async (text: string) => {
    const title = main.getByText(text, { exact: true });
    await expect(title).toBeVisible();
    // The block is the title's centered box: about as wide as the main column.
    const block = title.locator("xpath=..");
    const [inner, outer] = await Promise.all([block.boundingBox(), main.boundingBox()]);
    expect(inner && outer && inner.width > outer.width * 0.9).toBe(true);
    await expect(block.locator("svg").first()).toBeVisible();
    await expect(title).toHaveCSS("text-align", "center");
  };
  for (const [path, title] of [
    ["/app/invoices", "No invoices yet"],
    ["/app/activity", "No activity yet"],
    ["/app/transactions", "No transactions yet"],
  ] as const) {
    await page.goto(path);
    await fills(title);
    expect(await blockingViolations(page)).toEqual([]);
  }
  await page.goto("/app/transactions?q=zzzz");
  await fills("Nothing matches");
  await main.getByRole("button", { name: "Clear filter and search" }).click();
  await expect(main.getByText("No transactions yet", { exact: true })).toBeVisible();
  await context.close();
});

// R-69: on a phone each transaction is two lines: what and when, then who and the transaction.
test("the invoice's transactions read in two lines on a phone", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  const deposit = {
    txHash: hash("9"),
    logIndex: 0,
    from: `0x${"c".repeat(40)}`,
    amount: OPEN_INVOICE.amount,
    blockNumber: 1000,
    blockTime: "2026-10-09T08:30:00Z",
    status: "confirmed",
    late: false,
    blocksLeft: 0,
    blocksTotal: 0,
    secondsLeft: 0,
  };
  await page.route(
    (url) =>
      url.pathname.startsWith("/api/") &&
      url.pathname.endsWith(`/invoices/${OPEN_INVOICE.invoiceId}`),
    (route) =>
      route.fulfill({
        json: {
          ...OPEN_INVOICE,
          paymentStatus: "paid",
          settlementStatus: "settled",
          paidAt: "2026-10-09T08:31:00Z",
          settledAt: "2026-10-09T08:40:00Z",
          settlementTxHash: hash("5"),
          deposits: [deposit],
        },
      }),
  );
  await page.goto(`/app/invoices/${OPEN_INVOICE.invoiceId}`);
  const rows = page
    .getByRole("main")
    .locator("ul")
    .filter({ hasText: "Settlement" })
    .getByRole("listitem");
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) {
    const box = await row.boundingBox();
    // Kind and amount take two text lines, the side and transaction one more: never four or five wrapped lines.
    expect(box && box.height < 96).toBe(true);
    const [time, link] = await Promise.all([
      row.locator("time").boundingBox(),
      row.getByRole("link", { name: /Basescan/ }).boundingBox(),
    ]);
    // The time sits at the top right, the explorer link at the bottom right.
    expect(time && box && time.y - box.y < 20).toBe(true);
    expect(link && time && link.y > time.y).toBe(true);
  }
  expect(await page.evaluate(() => document.scrollingElement?.scrollWidth)).toBe(390);
  expect(await blockingViolations(page)).toEqual([]);
  await context.close();
});
