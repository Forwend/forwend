// @vitest-environment jsdom
import { TooltipProvider } from "@forwend/ui-web";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BalanceFigure } from "@/features/balances/components/balance-figure";
import type { Balances, TokenBalance } from "@/features/balances/types/balances";
import type { TokenPrice } from "@/features/prices/types/prices";

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

const now = new Date().toISOString();
const price = (chainId: number, token: string, usd: string | null): TokenPrice => ({
  chainId,
  token,
  symbol: "USDC",
  coinId: "usd-coin",
  usd,
  sourceUpdatedAt: now,
  fetchedAt: now,
  stale: usd === null,
});
const PRICES = [
  price(84532, "0x036cbd53842c5426634e7929541ec2318f3dcf7e", "1"),
  price(421614, "0x2222222222222222222222222222222222222222", "0.9990"),
];

function show(
  balances: Balances | null,
  { failed = false, prices = PRICES as readonly TokenPrice[] | undefined } = {},
) {
  return render(
    <BalanceFigure balances={balances} prices={prices} failed={failed} onRetry={() => {}} />,
    { wrapper: TooltipProvider },
  );
}

// The headline figure, whole part and cents, which sit in separate spans.
const total = () => document.querySelector("[data-money] > span")?.textContent;

describe("BalanceFigure", () => {
  afterEach(cleanup);

  it("does not hide held money smaller than one cent", () => {
    show({ tokens: [{ ...usdc, held: "1" }], estimatedUsdTotal: "2.50" });
    expect(screen.getByRole("link", { name: "<0.01 USD held for payers" })).toBeTruthy();
  });

  it("values tokens at their market prices, and never at 1 USD without one", () => {
    const usdt = {
      ...usdc,
      chainId: 421614,
      token: "0x2222222222222222222222222222222222222222",
      symbol: "USDT",
    };
    const { unmount } = show({ tokens: [usdc, usdt], estimatedUsdTotal: "5.00" });
    // 2.50 at 1 plus 2.50 at 0.9990 is 4.9975, cut to cents.
    expect(total()).toBe("4.99");
    unmount();
    show(
      { tokens: [usdc, usdt], estimatedUsdTotal: "5.00" },
      { prices: [PRICES[0] as TokenPrice] },
    );
    expect(total()).toBe("—");
  });

  it("adds several stablecoins in USD, and never shows a made-up 0", () => {
    const usdt = {
      ...usdc,
      chainId: 421614,
      token: "0x2222222222222222222222222222222222222222",
      symbol: "USDT",
    };
    const prices = [PRICES[0] as TokenPrice, price(421614, usdt.token, "1")];
    const { rerender } = show({ tokens: [usdc, usdt], estimatedUsdTotal: "5.00" }, { prices });
    expect(total()).toBe("5.00");
    expect(screen.getByRole("button", { name: /^Market value/ })).toBeTruthy();
    rerender(
      <BalanceFigure
        balances={{ tokens: [usdc, { ...usdt, wallet: null }], estimatedUsdTotal: null }}
        prices={prices}
        failed={false}
        onRetry={() => {}}
      />,
    );
    expect(total()).toBe("—");
  });
});
