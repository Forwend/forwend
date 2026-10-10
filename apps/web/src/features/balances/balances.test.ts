import { describe, expect, it } from "vitest";
import { type TokenBalance, usdTotal } from "@/features/balances/balances";

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

describe("usdTotal", () => {
  it("counts one token in USD cents, cut, not rounded up", () => {
    expect(usdTotal({ tokens: [usdc], estimatedUsdTotal: "2.50" }, "wallet")).toBe(250n);
  });

  it("adds tokens with different decimals before cutting to cents, so no cent is lost", () => {
    const dai = {
      ...usdc,
      symbol: "DAI",
      decimals: 18,
      wallet: "1999999999999999999",
      pending: "0",
    };
    expect(usdTotal({ tokens: [usdc, dai], estimatedUsdTotal: null }, "wallet")).toBe(450n);
    expect(usdTotal({ tokens: [usdc, dai], estimatedUsdTotal: null }, "pending")).toBe(100n);
  });

  it("gives no total when a wallet balance is missing or there is no token", () => {
    expect(
      usdTotal({ tokens: [usdc, { ...usdc, wallet: null }], estimatedUsdTotal: null }, "wallet"),
    ).toBeNull();
    expect(usdTotal({ tokens: [], estimatedUsdTotal: null }, "wallet")).toBeNull();
  });
});
