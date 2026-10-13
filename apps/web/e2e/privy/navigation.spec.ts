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
  // The timeline carries the invoice's status, at its Confirming step; the one pill left is the payment's own.
  const amountPanel = main.getByRole("region", { name: "Amount" });
  await expect(amountPanel.locator("[data-status]")).toHaveCount(1);
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
  await expect(main.getByText("No invoices match.")).toBeVisible();
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
  await expect(main.getByText("No transactions match.")).toBeVisible();
  await page.reload();
  await expect(main.getByText("No transactions match.")).toBeVisible();
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
