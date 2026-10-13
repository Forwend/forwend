import type { Page } from "@playwright/test";

// The app pages on sample data: the API is mocked, so the rows, statuses and transactions are known. One merchant
// profile with four invoices, the payments to two of them, and transfers on Base Sepolia.
const MERCHANT_ID = "22222222-2222-2222-2222-222222222222";
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
export const hash = (c: string) => `0x${c.repeat(64)}`;
const NOW = Date.now();
export const sampleInvoice = (
  number: number,
  paymentStatus: string,
  settlementStatus: string,
  title: string | null,
  client: string | null,
) => ({
  invoiceId: `0x${String(number).padStart(4, "0")}${"a".repeat(60)}`,
  number,
  title,
  note: null,
  dueDate: null,
  client: { name: client, email: null, address: null },
  issuer: null,
  chainId: 84532,
  token: USDC,
  amount: `${number}000000`,
  recipient: `0x${"7a21".repeat(10)}`,
  receiveAddress: `0x${"c".repeat(40)}`,
  expiresAt: new Date(NOW + 86_400_000).toISOString(),
  settleDeadline: new Date(NOW + 2 * 86_400_000).toISOString(),
  paymentStatus,
  settlementStatus,
  settlementTxHash: settlementStatus === "settled" ? hash("f") : null,
  createdAt: new Date(NOW - number * 3_600_000).toISOString(),
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
  blocksLeft,
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
  ...(deposit ? { txHash: deposit.txHash } : { settlementStatus: inv.settlementStatus }),
});
const ACTIVITY = INVOICES.flatMap((inv) => [
  ...((DEPOSITS[inv.invoiceId] ?? []) as { txHash: string; status: string }[]).map((d) =>
    activityItem(inv, d),
  ),
  activityItem(inv),
]);
export const sampleTransfer = (i: number) => ({
  chainId: 84532,
  token: USDC,
  symbol: "USDC",
  decimals: 6,
  direction: i % 4 === 3 ? "out" : "in",
  amount: `${(i + 1) * 1_000_000}`,
  counterparty: `0x${String(i).padStart(2, "0")}${"b".repeat(38)}`,
  txHash: `0x${String(i).padStart(2, "0")}${"9".repeat(62)}`,
  logIndex: 0,
  blockNumber: 1000 - i,
  at: new Date(NOW - i * 7_200_000).toISOString(),
  status: "confirmed",
});
export const TRANSFERS = Array.from({ length: 30 }, (_, i) => sampleTransfer(i));

type SampleInvoice = typeof CONFIRMING_INVOICE;
interface SampleItem {
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
}
const SAMPLE_LISTS: SampleLists = { invoices: INVOICES, activity: ACTIVITY, transfers: TRANSFERS };

// The API's filters and search (docs/backend/api.md) on the fields these samples use, then its cursor pages.
const invoiceFilter = (inv: Pick<SampleInvoice, "paymentStatus" | "settlementStatus">) =>
  inv.settlementStatus === "settled"
    ? "settled"
    : inv.paymentStatus === "paid"
      ? "paid"
      : inv.paymentStatus.startsWith("expired")
        ? "expired"
        : "open";
const itemFilter = (item: SampleItem) =>
  item.kind === "invoice"
    ? invoiceFilter({ paymentStatus: item.status, settlementStatus: item.settlementStatus ?? "" })
    : item.status === "confirmed"
      ? "paid"
      : "open";
function listPage<T>(
  url: URL,
  items: T[],
  filterOf: (t: T) => string,
  textOf: (t: T) => (string | null | undefined)[],
) {
  const limit = Number(url.searchParams.get("limit") ?? 20);
  const start = Number(url.searchParams.get("cursor") ?? 0);
  const filter = url.searchParams.get("status") ?? url.searchParams.get("direction");
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

export async function mockApi(page: Page, lists: SampleLists = SAMPLE_LISTS) {
  // Our API only: Privy's own API is also under /api/v1.
  await page.route("/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    if (path === "/v1/me") {
      return route.fulfill({
        json: {
          profiles: [
            {
              profileId: MERCHANT_ID,
              kind: "merchant",
              name: "Sample shop",
              walletAddress: `0x${"7a21".repeat(10)}`,
              createdAt: "2026-09-02T00:00:00Z",
            },
          ],
        },
      });
    }
    // The public read leaves out the client; the profile's own read has it.
    const owned = lists.invoices.find(
      (inv) => path === `/v1/profiles/${MERCHANT_ID}/invoices/${inv.invoiceId}`,
    );
    if (owned) {
      return route.fulfill({ json: { ...owned, deposits: DEPOSITS[owned.invoiceId] ?? [] } });
    }
    const invoice = lists.invoices.find((inv) => path === `/v1/invoices/${inv.invoiceId}`);
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
        lists.transfers,
        (t: SampleTransfer) => t.direction,
        (t) => [t.counterparty, t.txHash, t.symbol],
      );
      return route.fulfill({ json });
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
    if (what === "balance-history") {
      // A point per day: a year of them is what once ran the chart's hidden table far below the page.
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
