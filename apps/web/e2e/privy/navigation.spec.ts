import { expect, type Page, test } from "@playwright/test";
import { sidewaysScroll } from "../sideways";
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
import { code, email, session } from "./session";

async function pickStatus(page: Page, name: string) {
  await page
    .getByRole("main")
    .getByRole("button", { name: /^Status: / })
    .click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
}

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

  await page.goto("/app/invoices");
  await expect(crumbs.getByRole("link", { name: "Invoices" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await hiddenHeading("Invoices");
  const rows = main.getByRole("row").filter({ hasText: "INV-" });
  await expect(rows).toHaveCount(4);
  // The Payments list's states (D-114): paid includes money already in the wallet.
  await pickStatus(page, "Paid");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("INV-0003");
  await pickStatus(page, "Confirming");
  await expect(rows).toHaveCount(1);
  const search = main.getByRole("searchbox", { name: "Search invoices" });
  await search.fill("brightline");
  // Confirming already shows one row: wait for the search to reach the URL before the count means anything.
  await expect(page).toHaveURL(/[?&]q=brightline/);
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("INV-0004");
  await pickStatus(page, "All");
  await search.fill("inv-0001");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Expired");
  await search.fill("");
  expect(await blockingViolations(page)).toEqual([]);

  await rows.filter({ hasText: "INV-0004" }).click();
  await expect(page).toHaveURL(`/app/invoices/${CONFIRMING_INVOICE.invoiceId}`);
  await expect(crumbs.getByRole("link", { name: "INV-0004" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // The number is the heading; the title leads the quiet line under it.
  await expect(main.getByRole("heading", { level: 1, name: "INV-0004" })).toBeVisible();
  await expect(
    main.locator("header").getByText("Brand site · Billed to Brightline Studio", { exact: true }),
  ).toBeVisible();
  await expect(main.getByRole("link", { name: "Invoices" })).toHaveCount(0);
  await expect(main.getByRole("region", { name: "Billed to" })).toContainText("Brightline Studio");
  const confirmation = main.getByRole("status", { name: "Payment confirmation" });
  await expect(confirmation).toHaveText("Confirming (0/120)");
  await expect(confirmation.getByRole("button", { name: "About 6 min left" })).toBeVisible();
  // R-69: its progress and transactions show once, on its payment page.
  await expect(main.locator("header [data-status]")).toHaveCount(0);
  await expect(main.locator("header").getByRole("link", { name: "View payment" })).toHaveAttribute(
    "href",
    `/app/payments/${CONFIRMING_INVOICE.invoiceId}`,
  );
  expect(await blockingViolations(page)).toEqual([]);
  await crumbs.getByRole("link", { name: "Invoices" }).click();
  await expect(page).toHaveURL("/app/invoices");
  await crumbs.getByRole("link", { name: "Merchant · Sample shop" }).click();
  await expect(page).toHaveURL("/app");

  await sidebar.getByRole("link", { name: "Activity" }).click();
  await hiddenHeading("Activity");
  // Activity is a table like Payments: its body rows.
  const items = main.locator("tbody tr");
  await expect(items).toHaveCount(6);
  await expect(
    items.first().getByRole("link", { name: "View transaction on Basescan" }),
  ).toHaveAttribute("href", basescan(hash("d")));
  // Paid keeps every event of a payment that is paid now (D-114): its payment and its creation.
  await pickStatus(page, "Paid");
  await expect(items).toHaveCount(2);
  await expect(items).toContainText([/^Payment received.*Confirmed/, /^Invoice created.*Paid/]);
  await pickStatus(page, "All");
  await main.getByRole("searchbox", { name: "Search activity" }).fill(hash("e").slice(0, 10));
  await expect(items).toHaveCount(1);
  expect(await blockingViolations(page)).toEqual([]);
  await items.getByRole("link", { name: /^Payment/ }).click();
  await expect(page).toHaveURL(`/app/payments/${SETTLED_INVOICE.invoiceId}`);
  await page.goBack();
  await main.getByRole("searchbox", { name: "Search activity" }).fill("");
  await items
    .filter({ hasText: "Waiting for payment" })
    .getByRole("link", { name: /^Invoice created/ })
    .click();
  await expect(page).toHaveURL(`/app/invoices/${OPEN_INVOICE.invoiceId}`);

  await sidebar.getByRole("link", { name: "Transactions" }).click();
  await hiddenHeading("Transactions");
  await expect(
    main.getByRole("table").getByRole("link", { name: "View transaction on Basescan" }).first(),
  ).toHaveAttribute("href", basescan(`0x00${"9".repeat(62)}`));
  expect(await blockingViolations(page)).toEqual([]);

  // With a year of chart data, nothing may run on below the content.
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
    expect(await sidewaysScroll(small)).toBeLessThanOrEqual(0);
  }
  await small.goto(`/app/invoices/${CONFIRMING_INVOICE.invoiceId}`);
  await expect(small.getByRole("heading", { level: 1, name: "INV-0004" })).toBeVisible();
  await expect(small.getByRole("main").getByRole("link", { name: "Invoices" })).toBeVisible();
  expect(await sidewaysScroll(small)).toBeLessThanOrEqual(0);
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

  // INV-0003 is the 43rd invoice.
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
  await pickStatus(page, "Paid");
  await expect(page).toHaveURL("/app/invoices?q=zephyr&state=paid");
  await expect(main.getByText("Nothing matches", { exact: true })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
  await main.getByRole("button", { name: "Clear filter and search" }).click();
  await expect(page).toHaveURL("/app/invoices");
  await expect(invoiceSearch).toHaveValue("");
  await expect(rows).toHaveCount(20);
  await invoiceSearch.fill("monthly");
  await expect(page).toHaveURL("/app/invoices?q=monthly");
  await main.getByRole("button", { name: "Show more" }).click();
  await expect(rows).toHaveCount(40);
  await rows.first().getByRole("link").click();
  await expect(page).toHaveURL(`/app/invoices/${LONG_INVOICES[0]?.invoiceId}`);
  await page.goBack();
  await expect(page).toHaveURL("/app/invoices?q=monthly");
  await expect(invoiceSearch).toHaveValue("monthly");

  // The payment is the 41st item.
  await page.goto("/app/activity");
  // Activity is a table like Payments: its body rows.
  const items = main.locator("tbody tr");
  await expect(items).toHaveCount(20);
  await main
    .getByRole("searchbox", { name: "Search activity" })
    .fill(PAST_PAGE_DEPOSIT.slice(0, 12));
  await expect(items).toHaveCount(1);
  await expect(items).toContainText("Payment");
  await pickStatus(page, "Paid");
  await expect(page).toHaveURL(`/app/activity?q=${PAST_PAGE_DEPOSIT.slice(0, 12)}&state=paid`);
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

// R-54
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
  // The page reads its summary view (`?view=summary`), so match the path alone.
  await page.route(
    (url) =>
      url.pathname.startsWith("/api/") && url.pathname.endsWith(`/invoices/${paid.invoiceId}`),
    (route) => route.fulfill({ json: { ...paid, settlementWait: wait } }),
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

// R-55
test("an open invoice's page offers Check status and a settled one does not", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  await page.route(`/api/v1/invoices/${OPEN_INVOICE.payToken}/recheck`, (route) =>
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

// R-64
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
  // Read the tint after its transition: until then the transparent start differs as text in the tint's color space.
  const settled = (row: import("@playwright/test").Locator) =>
    row.evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})));
      return getComputedStyle(el).backgroundColor;
    });
  const hoverOf = async (row: import("@playwright/test").Locator) => {
    await page.mouse.move(0, 0);
    const before = await settled(row);
    await row.hover();
    await expect.poll(() => settled(row)).not.toBe(before);
    return settled(row);
  };
  await page.goto("/app/invoices");
  const invoiceHover = await hoverOf(main.locator("tbody tr").first());
  await page.goto("/app/activity");
  const activityHover = await hoverOf(main.locator("tbody tr").first());
  expect(invoiceHover).toBe(activityHover);

  await page.goto("/app/transactions");
  const exportButton = main.getByRole("button", { name: "Export", exact: true });
  const search = main.getByRole("searchbox", { name: "Search transactions" });
  const [exportBox, searchBox, mainBox] = await Promise.all([
    exportButton.boundingBox(),
    search.boundingBox(),
    main.locator("table").boundingBox(),
  ]);
  expect(exportBox && searchBox && mainBox).toBeTruthy();
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

// R-69
test("the owner's invoice page shows each state once, in its header", async ({ browser }) => {
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
    paid: status === "confirmed" ? amount : null,
    blocksLeft,
    blocksTotal: 120,
    secondsLeft: blocksLeft * 3,
  });
  const main = page.getByRole("main");
  const header = main.locator("header");
  const confirmation = header.getByRole("status", { name: "Payment confirmation" });
  // A reload signs in and redraws the shell, which under the full suite can outlast one check's wait.
  const shown = () =>
    expect(header.getByRole("link", { name: "View payment" })).toBeVisible({ timeout: 15_000 });

  // R-69, R-60: the header carries the state; progress and transactions show on the payment page.
  body = { ...OPEN_INVOICE, deposits: [] };
  await page.goto(`/app/invoices/${OPEN_INVOICE.invoiceId}`);
  await shown();
  await expect(main.getByRole("list", { name: "Payment progress" })).toHaveCount(0);
  await expect(header.getByText("Waiting for payment")).toBeVisible();
  await header.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Copy link" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /^Open pay page/ })).toHaveAttribute(
    "href",
    `http://localhost:3000/pay/${OPEN_INVOICE.payToken}?preview=1`,
  );
  await page.keyboard.press("Escape");
  await expect(main.getByRole("button", { name: "Check status" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  body = {
    ...OPEN_INVOICE,
    paymentStatus: "detected",
    deposits: [deposit("detected", OPEN_INVOICE.amount, 120)],
  };
  await page.reload();
  await shown();
  // R-60, R-69: while confirming, the count is the status, with no second badge.
  await expect(confirmation).toHaveText("Confirming (0/120)");
  await expect(confirmation.getByRole("button", { name: "About 6 min left" })).toBeVisible();
  await expect(header.locator("[data-status]")).toHaveCount(0);
  await expect(main.getByText(/test network|no real value/i)).toHaveCount(0); // R-72
  expect(await blockingViolations(page)).toEqual([]);
  // R-73
  body = {
    ...OPEN_INVOICE,
    paymentStatus: "detected",
    deposits: [deposit("detected", OPEN_INVOICE.amount, 60)],
  };
  await page.reload();
  await shown();
  await expect(confirmation).toHaveText("Confirming (60/120)");
  await expect(confirmation.getByRole("button", { name: "About 3 min left" })).toBeVisible();

  body = {
    ...OPEN_INVOICE,
    paymentStatus: "partially_paid",
    deposits: [deposit("confirmed", "1000000", 0)],
  };
  await page.reload();
  await shown();
  await expect(header.getByText("Partially paid")).toBeVisible();
  await expect(main.getByText("Received 1.00 USDC of 2.00 USDC")).toBeVisible();
  await expect(main.getByRole("status").filter({ hasText: "Partially paid" })).toHaveCount(0);
  expect(await blockingViolations(page)).toEqual([]);

  // R-69
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
  await expect(confirmation).toContainText("Confirming");
  await expect(header.getByText("Partially paid")).toHaveCount(0);

  body = {
    ...OPEN_INVOICE,
    paymentStatus: "paid",
    settlementStatus: "pending",
    paidAt: "2026-10-09T08:31:00Z",
    deposits: [deposit("confirmed", OPEN_INVOICE.amount, 0)],
  };
  await page.reload();
  await shown();
  await expect(header.getByText("Paid", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: "Check status" })).toHaveCount(0);
  // R-91
  await main.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Edit", "Duplicate"]);
  await page.keyboard.press("Escape");

  // R-69
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
  // The settlement is one of the payment page's transfers, never repeated here.
  await expect(main.getByText(settleTx)).toHaveCount(0);
  await expect(main.getByRole("region", { name: "Details" })).not.toContainText("Settlement");
  expect(await blockingViolations(page)).toEqual([]);

  // R-69
  body = { ...OPEN_INVOICE, paymentStatus: "expired", deposits: [] };
  await page.reload();
  await shown();
  await expect(main.locator("header").getByRole("link", { name: "New invoice" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Check status" })).toHaveCount(0);
  await context.close();
});

// R-77, D-25
test("the owner's invoice page names the next step of every exception", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page, {
    invoices: [OPEN_INVOICE],
    activity: [activityItem(OPEN_INVOICE)],
    transfers: [],
  });
  let body: object = OPEN_INVOICE;
  // The public and the owner's read of this invoice; the owner's carries the client.
  await page.route(
    (url) =>
      url.pathname.startsWith("/api/") &&
      url.pathname.endsWith(`/invoices/${OPEN_INVOICE.invoiceId}`),
    (route) => route.fulfill({ json: body }),
  );
  const paid = (amount: string, late = false) => ({
    txHash: late ? hash("8") : hash("9"),
    logIndex: 0,
    from: `0x${"c".repeat(40)}`,
    amount,
    blockNumber: 1000,
    blockTime: "2026-10-09T08:30:00Z",
    status: "confirmed",
    late,
    paid: late ? "0" : amount,
    blocksLeft: 0,
    blocksTotal: 120,
    secondsLeft: 0,
  });
  const closedAt = new Date(Date.now() - 60_000).toISOString();
  const main = page.getByRole("main");
  const header = main.locator("header");
  const open = async () => {
    await page.goto(`/app/invoices/${OPEN_INVOICE.invoiceId}`);
    await expect(main.getByRole("region", { name: "Details" })).toBeVisible({ timeout: 15_000 });
  };

  body = { ...OPEN_INVOICE, paymentStatus: "partially_paid", deposits: [paid("1000000")] };
  await open();
  await expect(main.getByText("Received 1.00 USDC of 2.00 USDC")).toBeVisible();
  await expect(header).not.toContainText("left to pay");
  await expect(header.getByRole("button", { name: "More actions" })).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  // The API's status still says open; `closed` says it sooner.
  body = { ...OPEN_INVOICE, expiresAt: closedAt, closesAt: closedAt, closed: true, deposits: [] };
  await open();
  await expect(main.getByRole("region", { name: "Details" })).toContainText("Checkout closed");
  // R-77: the next step sits with the header's actions, beside View payment, with no box under the title.
  await expect(header.getByRole("link", { name: "New invoice" })).toBeVisible();
  await expect(header.getByRole("link", { name: "New invoice" }).locator("+ a")).toHaveText(
    "View payment",
  );
  await expect(main).not.toContainText("can't take money again");
  await header.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Edit", "Duplicate"]);
  await page.keyboard.press("Escape");
  await main.getByRole("link", { name: "New invoice" }).click();
  await expect(page).toHaveURL(`/app/invoices/new?from=${OPEN_INVOICE.invoiceId}`);
  await expect(main.getByLabel("Amount")).toHaveValue("2");
  await expect(main.getByRole("textbox", { name: /^(Legal|Full) name$/ })).toHaveValue("Mara Ilić");

  body = {
    ...OPEN_INVOICE,
    paymentStatus: "expired_partially_paid",
    expiresAt: closedAt,
    closesAt: closedAt,
    closed: false,
    deposits: [paid("500000")],
  };
  await open();
  await expect(main.getByRole("region", { name: "Details" })).toContainText("Checkout closed");
  await expect(header.getByRole("link", { name: "New invoice" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Reopen checkout" })).toHaveCount(0);

  // R-130: while the API allows it, Reopen checkout comes first and asks to confirm.
  body = { ...body, reopenUntil: new Date(Date.now() + 5 * 86_400_000).toISOString() };
  await open();
  await expect(header.getByRole("button", { name: "Reopen checkout" })).toBeVisible();
  await main.getByRole("button", { name: "Reopen checkout" }).click();
  const reopen = page.getByRole("dialog", { name: /^Reopen INV-\d{4}\?$/ });
  await expect(reopen).toContainText("It reopens only once.");
  expect(await blockingViolations(page)).toEqual([]);
  await reopen.getByRole("button", { name: "Keep closed" }).click();
  await expect(main.getByRole("button", { name: "Reopen checkout" })).toBeFocused();
  await main.getByRole("link", { name: "New invoice" }).click();
  await expect(page).toHaveURL(`/app/invoices/new?from=${OPEN_INVOICE.invoiceId}`);
  await expect(main.getByLabel("Amount")).toHaveValue("2");

  // A paid invoice needs no next step, even with money held for the payer: its payment page shows that.
  body = {
    ...OPEN_INVOICE,
    paymentStatus: "paid",
    settlementStatus: "pending",
    paidAt: "2026-10-09T08:31:00Z",
    deposits: [paid(OPEN_INVOICE.amount), { ...paid("500000", true), logIndex: 1 }],
  };
  await open();
  await expect(header.getByRole("link", { name: "View payment" })).toBeVisible();
  await expect(header.getByRole("link", { name: "New invoice" })).toHaveCount(0);
  await expect(main).not.toContainText("is held for the payer");
  expect(await blockingViolations(page)).toEqual([]);
  await context.close();
});

// R-92
test("New invoice asks for billing details first, then comes back to the form", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page, undefined, null);
  await page.goto("/app/invoices/new");
  const main = page.getByRole("main");
  await expect(main.getByText("Add your billing details first")).toBeVisible();
  await expect(main.getByRole("button", { name: "Continue" })).toHaveCount(0);
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(0);
  expect(await blockingViolations(page)).toEqual([]);
  await main.getByRole("link", { name: "Add billing details" }).click();
  await expect(page).toHaveURL("/app/billing-details?then=new-invoice");
  await page.getByRole("textbox", { name: "Business name" }).fill("Sample shop GmbH");
  await page.getByRole("textbox", { name: "Address" }).fill("Hauptstr. 1, Berlin");
  await page.getByRole("button", { name: /^Country/ }).click();
  await page.getByRole("combobox", { name: /Country/ }).fill("germ");
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Contact email" }).fill("billing@shop.example");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page).toHaveURL("/app/invoices/new");
  await expect(main.getByRole("button", { name: "Continue" })).toBeVisible();
  await context.close();
});

// R-79
test("the owner cancels an invoice before any money, after confirming", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page, {
    invoices: [OPEN_INVOICE],
    activity: [activityItem(OPEN_INVOICE)],
    transfers: [],
  });
  let body: object = { ...OPEN_INVOICE, deposits: [] };
  let cancels = 0;
  await page.route(
    (url) =>
      url.pathname.startsWith("/api/") &&
      url.pathname.endsWith(`/invoices/${OPEN_INVOICE.invoiceId}`),
    (route) => route.fulfill({ json: body }),
  );
  await page.route(
    (url) => url.pathname.endsWith(`/invoices/${OPEN_INVOICE.invoiceId}/cancel`),
    (route) => {
      cancels++;
      body = {
        ...OPEN_INVOICE,
        paymentStatus: "canceled",
        canceledAt: new Date().toISOString(),
        deposits: [],
      };
      return route.fulfill({ json: body });
    },
  );
  const main = page.getByRole("main");
  const header = main.locator("header");
  await page.goto(`/app/invoices/${OPEN_INVOICE.invoiceId}`);
  const dialog = page.getByRole("dialog", { name: "Cancel INV-0002?" });

  const more = header.getByRole("button", { name: "More actions" });
  await more.click({ timeout: 15_000 });
  await page.getByRole("menuitem", { name: "Cancel invoice" }).click();
  await expect(dialog).toContainText("The pay link stops taking payments.");
  expect(await blockingViolations(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Keep invoice" }).click();
  await expect(dialog).toBeHidden();
  expect(cancels).toBe(0);

  await more.click();
  await page.getByRole("menuitem", { name: "Cancel invoice" }).click();
  await dialog.getByRole("button", { name: "Cancel invoice" }).click();
  await expect(page.getByText("INV-0002 canceled")).toBeVisible();
  expect(cancels).toBe(1);
  // R-60
  const canceledRow = main.getByRole("region", { name: "Details" }).locator("[tabindex='-1']");
  await expect(canceledRow).toContainText(/^Canceled on/);
  await expect(header.locator("[data-status]")).toHaveText("Canceled");
  await expect(canceledRow).toBeFocused();
  // R-91
  await header.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Edit", "Duplicate"]);
  await context.close();
});

// R-80
test("the owner turns email notifications off from Settings", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  const puts: unknown[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith("/notifications")) puts.push(r.postDataJSON());
  });
  await page.goto("/app");
  await page
    .getByRole("complementary")
    .getByRole("link", { name: "Settings" })
    .click({ timeout: 15_000 });
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("link", { name: "Notifications" })
    .click();
  await expect(page).toHaveURL("/app/notifications");
  const main = page.getByRole("main");
  const toggle = main.getByRole("switch", { name: "Email me about this profile's invoices" });
  await expect(toggle).toBeChecked();
  await expect(main).toContainText("Emails go to owner@example.com, the email you sign in with.");
  expect(await blockingViolations(page)).toEqual([]);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText("Email notifications off")).toBeVisible();
  expect(puts).toEqual([{ email: false }]);
  await context.close();
});

// R-136
test("Settings opens Accepted assets, where a box turns a token off", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  const arbitrum = "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d";
  let tokens = [
    {
      chainId: 84532,
      token: OPEN_INVOICE.token,
      symbol: "USDC",
      decimals: 6,
      network: "base-sepolia",
      on: true,
    },
    {
      chainId: 421614,
      token: arbitrum,
      symbol: "USDC",
      decimals: 6,
      network: "arbitrum-sepolia",
      on: true,
    },
  ];
  const puts: unknown[] = [];
  await page.route("/api/v1/profiles/*/tokens", async (route) => {
    if (route.request().method() === "PUT") {
      const { off } = route.request().postDataJSON() as {
        off: { chainId: number; token: string }[];
      };
      puts.push(off);
      tokens = tokens.map((t) => ({ ...t, on: !off.some((o) => o.chainId === t.chainId) }));
    }
    await route.fulfill({ json: { tokens } });
  });
  await page.goto("/app/settings");
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("link", { name: "Accepted assets" })
    .click();
  await expect(page).toHaveURL("/app/networks");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "USDC networks" }).click();
  const base = main.getByRole("checkbox", { name: /^USDC on Base Sepolia/ });
  const arb = main.getByRole("checkbox", { name: /^USDC on Arbitrum Sepolia/ });
  await expect(base).toBeChecked();
  await expect(arb).toBeChecked();
  expect(await blockingViolations(page)).toEqual([]);
  await arb.click();
  await expect(arb).not.toBeChecked();
  await expect(main.getByText("Changes saved.")).toBeVisible();
  expect(puts).toEqual([[{ chainId: 421614, token: arbitrum }]]);
  // The last one on stays on, as the API refuses turning every token off.
  await expect(base).toBeDisabled();
  await expect(main).toContainText("One stays on");
  expect(await blockingViolations(page)).toEqual([]);
  await context.close();
});

// R-137: the real Privy test account signs in again in the dialog; the API's answers are mocked.
test("saving billing details asks for a fresh sign-in, then saves with the new token", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  const tokens: (string | null)[] = [];
  await page.route("/api/v1/profiles/*/billing-details", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    tokens.push(await route.request().headerValue("authorization"));
    if (tokens.length === 1)
      return route.fulfill({
        status: 401,
        json: { error: { code: "reauth_required", message: "sign in again" } },
      });
    return route.fallback();
  });
  await page.goto("/app/billing-details");
  const save = page.getByRole("button", { name: "Save details" });
  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  // Cancel leaves the details unsaved and sends nothing more.
  await save.click();
  await expect(dialog).toContainText(`We sent a code to ${email}`);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(tokens).toHaveLength(1);
  tokens.length = 0;
  await save.click();
  await expect(dialog).toContainText(`We sent a code to ${email}`);
  expect(await blockingViolations(page)).toEqual([]);
  await dialog.getByRole("textbox", { name: "Code" }).fill(code);
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  // Signing in again replaces this browser's Privy session, so the tests after this one share the new session.
  await context.storageState({ path: session });
  await expect(page.getByText("Billing details saved")).toBeVisible();
  expect(tokens).toHaveLength(2);
  expect(tokens[1]).not.toEqual(tokens[0]);
  await context.close();
});

// R-137
test("Sign out everywhere asks first, then ends the sessions and signs out", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  await mockApi(page);
  let ended = 0;
  await page.route("/api/v1/me/sign-out-everywhere", (route) => {
    ended++;
    return route.fulfill({ status: 204 });
  });
  // Privy's own sign-out of this device would end the session the other tests share.
  await page.route("https://auth.privy.io/api/v1/sessions/logout", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.goto("/app/settings");
  const everywhere = page
    .getByRole("main")
    .getByRole("button", { name: "Sign out of all devices" });
  await everywhere.click({ timeout: 15_000 });
  const dialog = page.getByRole("dialog", { name: "Sign out everywhere?" });
  await expect(dialog).toContainText("This signs you out on every device and browser");
  expect(await blockingViolations(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Keep me signed in" }).click();
  await expect(dialog).toBeHidden();
  expect(ended).toBe(0);
  await everywhere.click();
  await dialog.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page).toHaveURL("/sign-in", { timeout: 15_000 });
  expect(ended).toBe(1);
  await context.close();
});

// R-81
test("the bell names each payment's event and opens the payment; plain money in opens its transaction", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const event = (id: number, kind: string, amount: string, minutesAgo: number) => ({
    id,
    kind,
    invoiceId: OPEN_INVOICE.invoiceId,
    number: OPEN_INVOICE.number,
    chainId: 84532,
    token: OPEN_INVOICE.token,
    symbol: "USDC",
    decimals: 6,
    amount,
    at: ago(minutesAgo),
  });
  // Transfer 1 is money in that pays nothing; transfer 0 is INV-0004's money reaching the wallet.
  const plain = { ...sampleTransfer(1), at: ago(2.5) };
  await mockApi(page, {
    invoices: [OPEN_INVOICE],
    activity: [],
    transfers: [plain, { ...sampleTransfer(0), at: ago(4) }],
    events: [
      event(3, "invoice.settled", "2000000", 1),
      event(2, "invoice.held", "500000", 2),
      event(1, "invoice.paid", "2000000", 3),
    ],
  });
  await page.goto("/app");
  const bell = page.getByRole("banner").getByRole("button", { name: /^Notifications/ });
  await expect(bell).toHaveAccessibleName("Notifications, 5 new", { timeout: 15_000 });
  await bell.click();
  const items = page.getByRole("menu").getByRole("menuitem");
  // Newest first, whatever the kind; each row names what happened, then the payment or the sender.
  const rows = [
    [/In your wallet · INV-0002/i, "2.00 USDC", `/app/payments/${OPEN_INVOICE.invoiceId}`],
    [/Held for the payer · INV-0002/i, "0.50 USDC", `/app/payments/${OPEN_INVOICE.invoiceId}`],
    [/Received · 0x01bb/i, "2.00 USDC", `/app/transactions?q=${plain.txHash}`],
    [/Paid · INV-0002/i, "2.00 USDC", `/app/payments/${OPEN_INVOICE.invoiceId}`],
    [/In your wallet · INV-0004/i, "1.00 USDC", `/app/payments/${CONFIRMING_INVOICE.invoiceId}`],
  ] as const;
  for (const [i, [name, amount, href]] of rows.entries()) {
    await expect(items.nth(i)).toContainText(name);
    await expect(items.nth(i)).toContainText(amount);
    await expect(items.nth(i)).toHaveAttribute("href", href);
  }
  // A business follows its payments.
  await expect(items.last()).toHaveText("View all");
  await expect(items.last()).toHaveAttribute("href", "/app/payments");
  expect(await blockingViolations(page)).toEqual([]);
  await items.nth(3).click();
  await expect(page).toHaveURL(`/app/payments/${OPEN_INVOICE.invoiceId}`);
  await expect(bell).toHaveAccessibleName("Notifications");
  await context.close();
});

// R-77
test("the invoice list and activity show a closed checkout as expired", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: session,
  });
  const page = await context.newPage();
  const closedAt = new Date(Date.now() - 60_000).toISOString();
  const closed = { ...OPEN_INVOICE, expiresAt: closedAt, closesAt: closedAt, closed: true };
  await mockApi(page, { invoices: [closed], activity: [activityItem(closed)], transfers: [] });
  const main = page.getByRole("main");
  await page.goto("/app/invoices");
  await expect(main.locator("tbody tr").first().locator("[data-status]")).toHaveText("Expired", {
    timeout: 15_000,
  });
  await page.goto("/app/activity");
  await expect(main.locator("[data-status]").first()).toHaveText("Expired", { timeout: 15_000 });
  await context.close();
});

// R-70
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
  // R-69
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
  ).toHaveText("Confirming");
  const fixed = page.getByRole("row").filter({ hasText: "INV-0002" });
  await expect(fixed).toContainText("USDC");
  await expect(fixed).toContainText("Base Sepolia");

  await page.goto("/app/activity");
  const rows = page.getByRole("main").locator("tbody tr");
  await expect(rows.first()).toContainText("Any network");
  await expect(rows.first()).toContainText("9.00 USD");
  await expect(rows.first()).not.toContainText("USDC");
  await expect(rows.nth(1)).toContainText("Base Sepolia");
  await expect(rows.nth(1)).toContainText("USDC");
  await context.close();
});

// R-74
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
    await expect.poll(() => sidewaysScroll(page)).toBeLessThanOrEqual(0);
    const [inner, outer] = await Promise.all([chart.boundingBox(), panel.boundingBox()]);
    expect(inner && outer && inner.width < outer.width).toBe(true);
  }
  await context.close();
});

// R-76
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
      sidebar.getByRole("button", { name: new RegExp(`^Switch profile: (.+ )?${kind}$`) }),
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
  const first = page
    .getByRole("main")
    .getByRole("link", { name: /\bINV-\d+/ })
    .first();
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

// R-75
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
    const block = title.locator("xpath=..");
    const [inner, outer] = await Promise.all([block.boundingBox(), main.boundingBox()]);
    expect(inner && outer && inner.width > outer.width * 0.9).toBe(true);
    await expect(block.locator("svg").first()).toBeVisible();
    await expect(title).toHaveCSS("text-align", "center");
    // Centered in what the screen shows under the header and the list's toolbar, not in a height guessed from the
    // whole window.
    const offset = await block.evaluate((el) => {
      const boxes = [...el.children].map((child) => child.getBoundingClientRect());
      const middle =
        (Math.min(...boxes.map((b) => b.top)) + Math.max(...boxes.map((b) => b.bottom))) / 2;
      const start = el.getBoundingClientRect().top;
      const top = Math.max(
        document.querySelector("header")?.getBoundingClientRect().bottom ?? 0,
        ...[...document.querySelectorAll("main *")]
          .filter((other) => !other.contains(el))
          .map((other) => other.getBoundingClientRect())
          .filter((box) => box.height > 1 && box.bottom <= start)
          .map((box) => box.bottom),
      );
      return Math.abs(middle - (top + innerHeight) / 2);
    });
    expect(offset).toBeLessThan(24);
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

test("a freelancer can reach invoices, activity and billing from the mobile menu", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: session,
  });
  const page = await context.newPage();
  await page.route("/api/v1/me", async (route) => {
    const response = await route.fetch();
    const me = await response.json();
    await route.fulfill({
      response,
      json: {
        ...me,
        profiles: me.profiles.map((profile: object) => ({ ...profile, kind: "freelancer" })),
      },
    });
  });
  await page.goto("/app");
  const tabs = page.getByRole("navigation", { name: "Main", exact: true });
  const more = page.getByRole("dialog", { name: "More" });
  for (const [label, path] of [
    ["Invoices", "/app/invoices"],
    ["Activity", "/app/activity"],
    ["Settings", "/app/settings"],
  ] as const) {
    await tabs.getByRole("button", { name: "More" }).click();
    await more.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(path);
    await expect(more).toBeHidden();
    await expect(tabs.getByRole("button", { name: "More" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await tabs.getByRole("button", { name: "More" }).click();
    await expect(more.getByRole("link", { name: label, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.keyboard.press("Escape");
  }
  // Billing details is a section of Settings.
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("link", { name: "Billing details" })
    .click();
  await expect(page).toHaveURL("/app/billing-details");
  await tabs.getByRole("button", { name: "More" }).click();
  await expect(more.getByRole("link", { name: "Settings", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.keyboard.press("Escape");
  await tabs.getByRole("button", { name: "More" }).click();
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(more).toBeHidden();
  await context.close();
});
