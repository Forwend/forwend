import { describe, expect, it } from "vitest";
import {
  historySeries,
  runningTotal,
  seriesChange,
  seriesTotal,
} from "@/features/balances/lib/balance-history";
import { marketUsd } from "@/features/balances/lib/balances";
import type { TokenHistory } from "@/features/balances/types/balance-history";
import type { TokenPrice } from "@/features/prices/types/prices";

const usdc: TokenHistory = {
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
  balances: ["0", "100000000", "70050000"],
  received: ["0", "100000000", "50000"],
  sent: ["0", "0", "30000000"],
};

const points = ["2026-10-09T00:00:00Z", "2026-10-10T00:00:00Z", "2026-10-10T09:30:00Z"].map(
  (at, i) => ({
    at,
    estimatedUsd: ["0.00", "100.00", "70.05"][i] ?? null,
    receivedUsd: ["0.00", "100.00", "0.05"][i] ?? null,
    sentUsd: ["0.00", "0.00", "30.00"][i] ?? null,
  }),
);

const price = (chainId: number, usd: string | null): TokenPrice => ({
  chainId,
  token: usdc.token,
  symbol: "USDC",
  coinId: "usd-coin",
  usd,
  sourceUpdatedAt: null,
  fetchedAt: null,
  stale: false,
});
const prices = [price(84532, "1"), price(421614, "1")];

describe("historySeries", () => {
  it("shows every token together in USD cents, one per point, ending now", () => {
    const series = historySeries(
      { points, tokens: [usdc, { ...usdc, chainId: 421614 }] },
      "received",
      prices,
    );
    expect(series?.values).toEqual([0n, 20000n, 10n]);
    expect(series?.dates.at(-1)?.toISOString()).toBe("2026-10-10T09:30:00.000Z");
  });

  it("values each day at the market price the total uses, so its last point is the total", () => {
    const market = [price(84532, "0.9992")];
    const series = historySeries({ points, tokens: [usdc] }, "balances", market);
    expect(series?.values).toEqual([0n, 9992n, 6999n]);
    const wallet = { chainId: 84532, token: usdc.token, decimals: 6, wallet: "70050000" };
    const total = marketUsd({ tokens: [wallet] } as never, "wallet", market);
    expect(series?.values.at(-1)).toBe(total);
  });

  it("cuts money in to cents once over the range, so no day drops a part of a cent", () => {
    const days = points.map((p, i) => ({ ...p, at: `2026-10-1${i}T00:00:00Z` }));
    const daily = { ...usdc, received: ["1000000", "1000000", "1000000"] };
    const series = historySeries({ points: days, tokens: [daily] }, "received", [
      price(84532, "0.9992"),
    ]);
    if (!series) throw new Error("no series");
    // 3 × 0.9992 = 2.9976 USD: 299 cents, where three days cut apart would give 3 × 99 = 297.
    expect(seriesTotal(series)).toBe(299n);
    expect(series.values).toEqual([99n, 100n, 100n]);
    expect(runningTotal(series).values.at(-1)).toBe(299n);
  });

  it("draws nothing rather than a made-up value when a balance or a price is missing", () => {
    const missing = { ...usdc, balances: null };
    expect(historySeries({ points, tokens: [missing] }, "balances", prices)).toBeNull();
    expect(historySeries({ points: [], tokens: [usdc] }, "balances", prices)).toBeNull();
    expect(historySeries({ points, tokens: [usdc] }, "balances", [price(84532, null)])).toBeNull();
    expect(historySeries({ points, tokens: [usdc] }, "balances", undefined)).toBeNull();
  });

  it("sums and compares exactly", () => {
    const received = historySeries({ points, tokens: [usdc] }, "received", prices);
    const balances = historySeries({ points, tokens: [usdc] }, "balances", prices);
    if (!received || !balances) throw new Error("no series");
    expect(seriesTotal(received)).toBe(10005n);
    expect(seriesChange(balances)).toBe(7005n);
  });
});

describe("runningTotal", () => {
  it("adds the days up in order, keeping every cent, and ends on the whole total", () => {
    const series = {
      dates: ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"].map((d) => new Date(d)),
      values: [0n, 2500n, 0n, 1n],
    };
    const total = runningTotal(series);
    expect(total.values).toEqual([0n, 2500n, 2500n, 2501n]);
    expect(total.dates).toBe(series.dates);
    expect(total.values.at(-1)).toBe(seriesTotal(series));
  });
});
