import { describe, expect, it } from "vitest";
import {
  historySeries,
  runningTotal,
  seriesChange,
  seriesTotal,
} from "@/features/balances/lib/balance-history";
import type { TokenHistory } from "@/features/balances/types/balance-history";

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

describe("historySeries", () => {
  it("shows every token together in USD cents, one per point, ending now", () => {
    const series = historySeries(
      { points, tokens: [usdc, { ...usdc, chainId: 421614 }] },
      "received",
    );
    expect(series?.values).toEqual([0n, 10000n, 5n]);
    expect(series?.dates.at(-1)?.toISOString()).toBe("2026-10-10T09:30:00.000Z");
  });

  it("draws nothing rather than a made-up 0 when a balance is missing", () => {
    const missing = points.map((p) => ({ ...p, estimatedUsd: null }));
    expect(historySeries({ points: missing, tokens: [usdc] }, "balances")).toBeNull();
    expect(historySeries({ points: [], tokens: [usdc] }, "balances")).toBeNull();
  });

  it("sums and compares exactly", () => {
    const received = historySeries({ points, tokens: [usdc] }, "received");
    const balances = historySeries({ points, tokens: [usdc] }, "balances");
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
