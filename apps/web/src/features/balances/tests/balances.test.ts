import { describe, expect, it } from "vitest";
import { marketUsd } from "@/features/balances/lib/balances";
import type { TokenBalance } from "@/features/balances/types/balances";
import type { TokenPrice } from "@/features/prices/types/prices";

const usdc: TokenBalance = {
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
  wallet: "2509999",
  finalizedBlock: 100,
  pending: "1000000",
  held: "0",
};

const NOW = Date.parse("2026-10-28T12:00:00Z");
const at = (chainId: number, token: string, usd: string): TokenPrice => ({
  chainId,
  token,
  symbol: "USDC",
  coinId: "usd-coin",
  usd,
  sourceUpdatedAt: "2026-10-28T11:55:00Z",
  fetchedAt: "2026-10-28T11:58:00Z",
  stale: false,
});
const ONE = [at(84532, usdc.token, "1")];
const usdTotal = (balances: Parameters<typeof marketUsd>[0], field: "wallet" | "pending") =>
  marketUsd(balances, field, ONE, NOW);

describe("marketUsd", () => {
  it("counts one token in USD cents, cut, not rounded up", () => {
    expect(usdTotal({ tokens: [usdc], estimatedUsdTotal: "2.50" }, "wallet")).toBe(250n);
  });

  it("adds tokens with different decimals before cutting to cents, so no cent is lost", () => {
    const dai = {
      ...usdc,
      chainId: 1,
      token: "0x1111111111111111111111111111111111111111",
      symbol: "DAI",
      decimals: 18,
      wallet: "1999999999999999999",
      pending: "0",
    };
    const prices = [...ONE, at(1, dai.token, "1")];
    const balances = { tokens: [usdc, dai], estimatedUsdTotal: null };
    expect(marketUsd(balances, "wallet", prices, NOW)).toBe(450n);
    expect(marketUsd(balances, "pending", prices, NOW)).toBe(100n);
  });

  it("gives no total when a wallet balance is missing or there is no token", () => {
    expect(
      usdTotal({ tokens: [usdc, { ...usdc, wallet: null }], estimatedUsdTotal: null }, "wallet"),
    ).toBeNull();
    expect(usdTotal({ tokens: [], estimatedUsdTotal: null }, "wallet")).toBeNull();
  });

  it("values at the market price, and gives no total without a fresh one instead of 1 USD", () => {
    const tokens = { tokens: [usdc], estimatedUsdTotal: null };
    expect(marketUsd(tokens, "wallet", [at(84532, usdc.token, "0.9996")], NOW)).toBe(250n);
    expect(marketUsd(tokens, "wallet", [], NOW)).toBeNull();
    expect(marketUsd(tokens, "wallet", undefined, NOW)).toBeNull();
    const old = { ...at(84532, usdc.token, "1"), fetchedAt: "2026-10-28T09:00:00Z" };
    expect(marketUsd(tokens, "wallet", [old], NOW)).toBeNull();
  });
});
