// @vitest-environment jsdom
import { TooltipProvider } from "@forwend/ui-web";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BalanceFigure } from "@/features/balances/components/balance-figure";
import type { Balances, TokenBalance } from "@/features/balances/types/balances";

const usdc: TokenBalance = {
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
  wallet: "2500000",
  finalizedBlock: 100,
  pending: "0",
  held: "0",
};

function show(balances: Balances | null, { failed = false } = {}) {
  return render(<BalanceFigure balances={balances} failed={failed} onRetry={() => {}} />, {
    wrapper: TooltipProvider,
  });
}

describe("BalanceFigure", () => {
  afterEach(cleanup);

  it("does not hide held money smaller than one cent", () => {
    show({ tokens: [{ ...usdc, held: "1" }], estimatedUsdTotal: "2.50" });
    expect(screen.getByRole("link", { name: "<0.01 USD held for payers" })).toBeTruthy();
  });

  it("adds several stablecoins in USD, and never shows a made-up 0", () => {
    const usdt = {
      ...usdc,
      chainId: 421614,
      token: "0x2222222222222222222222222222222222222222",
      symbol: "USDT",
    };
    const { rerender } = show({ tokens: [usdc, usdt], estimatedUsdTotal: "5.00" });
    expect(screen.getByText("5.00")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Estimated:/ })).toBeTruthy();
    rerender(
      <BalanceFigure
        balances={{ tokens: [usdc, { ...usdt, wallet: null }], estimatedUsdTotal: null }}
        failed={false}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/—/)).toBeTruthy();
    expect(screen.queryByText("0.00")).toBeNull();
  });
});
