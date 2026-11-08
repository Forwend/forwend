import type { Page } from "@playwright/test";

const MERCHANT_ID = "22222222-2222-2222-2222-222222222222";
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";

const SAMPLE_STORE = {
  storeId: "66666666-6666-4666-8666-666666666666",
  name: "Sample shop",
  defaultExpiresIn: 3600,
  allowedOrigins: [],
  brandColor: null,
  logoAt: null,
  tokensOff: [],
  updatedAt: "2026-09-02T00:00:00Z",
};

export const hash = (c: string) => `0x${c.repeat(64)}`;
// GET /v1/me lists every permission for the owner (R-138). Its profiles are in Developer mode, on the testnets (D-120).
export const OWNER = {
  role: "owner",
  livemode: false,
  permissions: [
    "invoices.read",
    "invoices.write",
    "stores.read",
    "stores.write",
    "clients.read",
    "clients.write",
    "money.read",
    "money.write",
    "billing.read",
    "billing.write",
    "tokens.read",
    "tokens.write",
    "jobs",
    "notifications",
    "team",
    "team.leave",
    "keys",
    "webhooks",
  ],
};
const NOW = Date.now();
export const sampleInvoice = (
  number: number,
  paymentStatus: string,
  settlementStatus: string,
  title: string | null,
  client: string | null,
) => ({
  invoiceId: `0x${String(number).padStart(4, "0")}${"a".repeat(60)}`,
  payToken: `${String(number).padStart(4, "0")}${"b".repeat(60)}`,
  optionId: `0x${String(number).padStart(4, "0")}${"a".repeat(60)}`,
  optionLocked: paymentStatus !== "open",
  optionCount: 1,
  confirming: paymentStatus === "detected",
  closed: false,
  options: [
    {
      optionId: `0x${String(number).padStart(4, "0")}${"a".repeat(60)}`,
      chainId: 84532,
      network: "base-sepolia",
      token: USDC,
      symbol: "USDC",
      decimals: 6,
      amount: `${number}000000`,
      receiveAddress: `0x${"c".repeat(40)}`,
      deposits: [],
    },
  ],
  number,
  title,
  note: null,
  dueDate: null,
  supplyDate: null,
  reference: null as string | null,
  agreedValue: null,
  client: { name: client, email: null, address: null, country: null, taxId: null },
  issuer: null,
  senderName: null,
  returnUrl: null,
  chainId: 84532,
  livemode: false,
  token: USDC,
  amount: `${number}000000`,
  recipient: `0x${"7a21".repeat(10)}`,
  factory: "0xf93da73f1308a9b34aab78bf6d84f0bacc600dd2",
  receiveAddress: `0x${"c".repeat(40)}`,
  expiresAt: new Date(NOW + 86_400_000).toISOString(),
  closesAt: new Date(NOW + 86_400_000).toISOString(),
  settleDeadline: new Date(NOW + 2 * 86_400_000).toISOString(),
  paymentStatus,
  settlementStatus,
  settlementTxHash: settlementStatus === "settled" ? hash("f") : null,
  createdAt: new Date(NOW - number * 3_600_000).toISOString(),
  // The detail read's own fields; a list answer leaves them out.
  paidAt:
    paymentStatus === "paid" ? new Date(NOW - number * 3_600_000 + 600_000).toISOString() : null,
  settledAt:
    settlementStatus === "settled"
      ? new Date(NOW - number * 3_600_000 + 1_200_000).toISOString()
      : null,
  canceledAt: null,
  nextCheckAt: null,
  updates: [],
  replacedBy: null,
  lines: [],
});
export const CONFIRMING_INVOICE = sampleInvoice(
  4,
  "detected",
  "none",
  "Brand site",
  "Brightline Studio",
);
export const SETTLED_INVOICE = sampleInvoice(
  3,
  "paid",
  "settled",
  "October retainer",
  "Kettle & Co.",
);
export const OPEN_INVOICE = sampleInvoice(2, "open", "none", "Logo refresh", "Mara Ilić");
const INVOICES = [
  CONFIRMING_INVOICE,
  SETTLED_INVOICE,
  OPEN_INVOICE,
  sampleInvoice(1, "expired", "none", null, null),
];
const sampleDeposit = (inv: typeof CONFIRMING_INVOICE, status: string, blocksLeft: number) => ({
  txHash: hash(status === "detected" ? "d" : "e"),
  logIndex: 0,
  from: `0x${"c".repeat(40)}`,
  amount: inv.amount,
  blockNumber: 1000,
  blockTime: "2026-10-09T08:30:00Z",
  status,
  late: false,
  paid: status === "confirmed" ? inv.amount : null,
  blocksLeft,
  blocksTotal: blocksLeft,
  secondsLeft: blocksLeft * 3,
});
const DEPOSITS: Record<string, object[]> = {
  [CONFIRMING_INVOICE.invoiceId]: [sampleDeposit(CONFIRMING_INVOICE, "detected", 120)],
  [SETTLED_INVOICE.invoiceId]: [sampleDeposit(SETTLED_INVOICE, "confirmed", 0)],
};
export const activityItem = (
  inv: typeof CONFIRMING_INVOICE,
  deposit?: { txHash: string; status: string },
) => ({
  kind: deposit ? "deposit" : "invoice",
  at: inv.createdAt,
  invoiceId: inv.invoiceId,
  chainId: inv.chainId,
  token: inv.token,
  symbol: "USDC",
  decimals: 6,
  amount: inv.amount,
  status: deposit ? deposit.status : inv.paymentStatus,
  optionCount: deposit ? 1 : inv.optionCount,
  ...(deposit ? { txHash: deposit.txHash } : { settlementStatus: inv.settlementStatus }),
  closed: deposit ? false : inv.closed,
  held: false,
});
const ACTIVITY = INVOICES.flatMap((inv) => [
  ...((DEPOSITS[inv.invoiceId] ?? []) as { txHash: string; status: string }[]).map((d) =>
    activityItem(inv, d),
  ),
  activityItem(inv),
]);
export const sampleTransfer = (i: number) => {
  const out = i % 4 === 3;
  // R-108
  const paid = !out && i % 5 === 0;
  return {
    chainId: 84532,
    token: USDC,
    symbol: "USDC",
    decimals: 6,
    direction: out ? "out" : "in",
    amount: `${(i + 1) * 1_000_000}`,
    counterparty: `0x${String(i).padStart(2, "0")}${"b".repeat(38)}`,
    txHash: `0x${String(i).padStart(2, "0")}${"9".repeat(62)}`,
    logIndex: 0,
    blockNumber: 1000 - i,
    at: new Date(NOW - i * 7_200_000).toISOString(),
    status: "confirmed",
    usdValue: `${i + 1}.000000`,
    classification: out ? "sent" : paid ? "invoice" : "unclassified",
    labelable: !out && !paid,
    invoice: paid
      ? {
          invoiceId: CONFIRMING_INVOICE.invoiceId,
          number: CONFIRMING_INVOICE.number,
          clientName: CONFIRMING_INVOICE.client.name,
        }
      : null,
    recordsValue: null as { currency: string; amount: string; rateDate: string } | null,
    // R-224: the first send paid its own fee, as on Arc; the rest show none.
    feePaid: i === 3 ? "3908" : null,
  };
};
export const TRANSFERS = Array.from({ length: 30 }, (_, i) => sampleTransfer(i));

type SampleInvoice = typeof CONFIRMING_INVOICE;
interface SampleItem {
  paymentStatus?: string;
  confirming?: boolean;
  amount?: string;
  closed?: boolean;
  kind: string;
  status: string;
  settlementStatus?: string;
  txHash?: string;
  symbol: string;
}
type SampleTransfer = ReturnType<typeof sampleTransfer>;
interface SampleLists {
  invoices: SampleInvoice[];
  activity: SampleItem[];
  transfers: SampleTransfer[];
  // The bell's invoice events (R-81); none unless a test gives them.
  events?: object[];
}
const SAMPLE_LISTS: SampleLists = { invoices: INVOICES, activity: ACTIVITY, transfers: TRANSFERS };

// The API's filters and search (docs/backend/api.md) on the fields these samples use, then its cursor pages.
// The `state` filter (D-114): paid stays paid once in the wallet; a detected payment is confirming.
const invoiceFilter = (inv: Pick<SampleInvoice, "paymentStatus">) =>
  inv.paymentStatus === "paid"
    ? "paid"
    : inv.paymentStatus.startsWith("expired")
      ? "expired"
      : inv.paymentStatus === "detected"
        ? "confirming"
        : inv.paymentStatus === "partially_paid" || inv.paymentStatus === "canceled"
          ? inv.paymentStatus
          : "waiting";
const itemFilter = (item: SampleItem) =>
  item.kind === "invoice"
    ? invoiceFilter({ paymentStatus: item.status })
    : item.status === "confirmed"
      ? "paid"
      : "confirming";
function listPage<T>(
  url: URL,
  items: T[],
  filterOf: (t: T) => string,
  textOf: (t: T) => (string | null | undefined)[],
) {
  const limit = Number(url.searchParams.get("limit") ?? 20);
  const start = Number(url.searchParams.get("cursor") ?? 0);
  const filter = url.searchParams.get("state") ?? url.searchParams.get("direction");
  const q = url.searchParams.get("q")?.toLowerCase();
  const matched = items.filter(
    (t) =>
      (!filter || filterOf(t) === filter) &&
      (!q || textOf(t).some((text) => text?.toLowerCase().includes(q))),
  );
  const end = start + limit;
  return {
    items: matched.slice(start, end),
    nextCursor: end < matched.length ? String(end) : null,
  };
}

// R-92
const SAMPLE_BILLING = {
  name: "Sample shop GmbH",
  address: "Hauptstr. 1\n10115 Berlin",
  country: "DE",
  taxId: null,
  email: "billing@shop.example",
  updatedAt: "2026-09-02T00:00:00Z",
};

/** null as billing: a merchant that has not saved them yet. */
export async function mockApi(
  page: Page,
  lists: SampleLists = SAMPLE_LISTS,
  billing: object | null = SAMPLE_BILLING,
) {
  // The profile's email setting (R-80), changed by PUT for the rest of the page's life.
  const notifications = { email: true, address: "owner@example.com" };
  let details = billing;
  // R-110: the records currency PUT saves; with one, each transaction has its value at a fixed 0.90 per USD.
  let recordsCurrency: string | null = null;
  // Our API only: Privy's own API is also under /api/v1.
  await page.route("/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    // Confirm it's you is the real api's: it emails the code the test reads (R-137).
    if (path.startsWith("/v1/me/fresh-sign-in")) return route.fallback();
    // USDC at exactly 1 USD, so the overview's figures read their token amounts (R-178).
    if (path === "/v1/prices") {
      return route.fulfill({
        json: {
          prices: [
            {
              chainId: 84532,
              token: USDC,
              symbol: "USDC",
              coinId: "usd-coin",
              usd: "1",
              sourceUpdatedAt: new Date(NOW).toISOString(),
              fetchedAt: new Date(NOW).toISOString(),
              stale: false,
            },
          ],
        },
      });
    }
    if (path === "/v1/me") {
      return route.fulfill({
        json: {
          onboardedAt: "2026-09-02T00:00:00Z",
          profiles: [
            {
              profileId: MERCHANT_ID,
              kind: "merchant",
              name: "Sample shop",
              walletAddress: `0x${"7a21".repeat(10)}`,
              createdAt: "2026-09-02T00:00:00Z",
              ...OWNER,
            },
          ],
        },
      });
    }
    // The public read, by the pay link's token (D-86), leaves out the client; the profile's own read has it.
    const owned = lists.invoices.find(
      (inv) => path === `/v1/profiles/${MERCHANT_ID}/invoices/${inv.invoiceId}`,
    );
    if (owned) {
      return route.fulfill({ json: { ...owned, deposits: DEPOSITS[owned.invoiceId] ?? [] } });
    }
    const invoice = lists.invoices.find((inv) => path === `/v1/invoices/${inv.payToken}`);
    if (invoice) {
      const { client: _, ...open } = invoice;
      return route.fulfill({ json: { ...open, deposits: DEPOSITS[invoice.invoiceId] ?? [] } });
    }
    const what = path.split(`/v1/profiles/${MERCHANT_ID}/`)[1];
    if (what === "invoices") {
      const json = listPage(url, lists.invoices, invoiceFilter, (inv: SampleInvoice) => [
        `INV-${String(inv.number).padStart(4, "0")}`,
        inv.title,
        inv.note,
        inv.client.name,
        inv.client.email,
        inv.receiveAddress,
      ]);
      return route.fulfill({ json });
    }
    if (what === "activity") {
      const json = listPage(url, lists.activity, itemFilter, (item) => [item.txHash, item.symbol]);
      return route.fulfill({ json });
    }
    if (what === "transactions") {
      const json = listPage(
        url,
        lists.transfers.map((t) =>
          recordsCurrency
            ? {
                ...t,
                recordsValue: {
                  currency: recordsCurrency,
                  amount: (Number(t.usdValue) * 0.9).toFixed(2),
                  rateDate: "2026-10-16",
                },
              }
            : t,
        ),
        (t: SampleTransfer) => t.direction,
        (t) => [t.counterparty, t.txHash, t.symbol],
      );
      return route.fulfill({ json });
    }
    if (what === "records-currency") {
      if (route.request().method() === "PUT")
        recordsCurrency = route.request().postDataJSON().currency;
      return route.fulfill({ json: { currency: recordsCurrency } });
    }
    // R-108
    if (what?.startsWith("transactions/") && what.endsWith("/label"))
      return route.fulfill({ status: 204 });
    if (what === "transactions.csv")
      return route.fulfill({ contentType: "text/csv", body: "Date (UTC),Direction\r\n" });
    // R-112
    if (what === "statement.pdf")
      return route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4" });
    if (what?.startsWith("events")) return route.fulfill({ json: { items: lists.events ?? [] } });
    if (what === "webhooks") return route.fulfill({ json: { endpoints: [] } });
    if (what === "stores") return route.fulfill({ json: { stores: [SAMPLE_STORE] } });
    if (what === `stores/${SAMPLE_STORE.storeId}`) return route.fulfill({ json: SAMPLE_STORE });
    if (what === "payments") return route.fulfill({ json: { items: [], nextCursor: null } });
    if (what === "billing-details") {
      if (route.request().method() === "PUT")
        details = { ...route.request().postDataJSON(), updatedAt: "2026-10-17T12:00:00Z" };
      return details
        ? route.fulfill({ json: details })
        : route.fulfill({
            status: 404,
            json: { error: { code: "billing_details_not_found", message: "no billing details" } },
          });
    }
    if (what === "notifications") {
      if (route.request().method() === "PUT")
        notifications.email = route.request().postDataJSON().email;
      return route.fulfill({ json: notifications });
    }
    if (what === "balances") {
      return route.fulfill({
        json: {
          tokens: [
            {
              chainId: 84532,
              token: USDC,
              symbol: "USDC",
              decimals: 6,
              wallet: "18420350000",
              finalizedBlock: 1000,
              pending: "0",
              held: "0",
            },
          ],
          estimatedUsdTotal: "18420.35",
        },
      });
    }
    // The enabled tokens (R-136), which the invoice pages read for each token's symbol and decimals.
    if (what === "tokens") {
      return route.fulfill({
        json: {
          tokens: [
            {
              chainId: 84532,
              token: USDC,
              symbol: "USDC",
              decimals: 6,
              network: "base-sepolia",
              on: true,
            },
          ],
        },
      });
    }
    if (what === "balance-history") {
      const days = Number(url.searchParams.get("days"));
      const zeros = Array.from({ length: days }, () => "0");
      // 25 USDC in every 7th day: a range with nothing received shows a sentence, not the chart.
      const weekly = (i: number) => (i % 7 === 0 ? 25 : 0);
      return route.fulfill({
        json: {
          points: zeros.map((_, i) => ({
            at: new Date(NOW - (days - 1 - i) * 86_400_000).toISOString(),
            estimatedUsd: "18420.35",
            receivedUsd: `${weekly(i)}.00`,
            sentUsd: "0.00",
          })),
          tokens: [
            {
              chainId: 84532,
              token: USDC,
              symbol: "USDC",
              decimals: 6,
              balances: zeros.map(() => "18420350000"),
              received: zeros.map((_, i) => String(weekly(i) * 1_000_000)),
              sent: zeros,
            },
          ],
        },
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
}
