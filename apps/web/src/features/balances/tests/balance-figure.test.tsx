// @vitest-environment jsdom
import { TooltipProvider } from "@forwend/ui-web";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BalanceFigure } from "@/features/balances/components/balance-figure";
import { MoneyActions } from "@/features/balances/components/money-actions";
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

  // The hero's label says "in USD" with the estimate hint; the figure alone stays centered, and still reads its unit.
  it("shows the total in USD, also for a single stablecoin", () => {
    show({ tokens: [usdc], estimatedUsdTotal: "2.50" });
    expect(screen.getByText("2.50").closest("p")?.textContent).toBe("2.50 USD");
  });

  it("shows pending and held apart from the wallet, each only when there is some", () => {
    const { rerender } = show({ tokens: [usdc], estimatedUsdTotal: "2.50" });
    expect(screen.queryByText(/on its way/)).toBeNull();
    expect(screen.queryByText(/held for payers/)).toBeNull();
    rerender(
      <BalanceFigure
        balances={{
          tokens: [{ ...usdc, pending: "1000000", held: "250000" }],
          estimatedUsdTotal: "2.50",
        }}
        failed={false}
        onRetry={() => {}}
      />,
    );
    // Just the amount and "on its way", no explanation after it (R-72).
    expect(screen.getByText(/on its way/).textContent).toMatch(/^1\.00\s*USD on its way$/);
    expect(screen.getByText(/held for payers/).textContent).toContain("0.25");
  });

  it("summarizes hundreds of held tokens in one USD link to their balances", () => {
    const tokens = Array.from({ length: 200 }, (_, i) => ({
      ...usdc,
      token: `0x${(i + 1).toString(16).padStart(40, "0")}`,
      held: "3750",
    }));
    tokens.push({ ...usdc, symbol: "OUSD", held: "20000" });
    show({ tokens, estimatedUsdTotal: null });
    const link = screen.getByRole("link", { name: "0.77 USD held for payers" });
    expect(link.getAttribute("href")).toBe("/app/balances");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

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

  it("offers a retry when the balances could not be loaded", () => {
    show(null, { failed: true });
    expect(screen.getByRole("alert").textContent).toContain("We could not load the balances.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("MoneyActions", () => {
  afterEach(cleanup);

  it("Receive and Request work; Send, Transfer and Withdraw say why in their name and do nothing", () => {
    const onReceive = vi.fn();
    const onRequest = vi.fn();
    render(<MoneyActions onReceive={onReceive} onRequest={onRequest} />, {
      wrapper: TooltipProvider,
    });
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    expect(onReceive).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    expect(onRequest).toHaveBeenCalledOnce();
    for (const [name, reason] of [
      ["Send", "send to another wallet"],
      ["Transfer", "between your profiles"],
      ["Withdraw", "to your bank"],
    ]) {
      const button = screen.getByRole("button", { name: new RegExp(`^${name}`) });
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(button.textContent).toContain(reason);
      fireEvent.click(button);
    }
    expect(onReceive).toHaveBeenCalledOnce();
    expect(onRequest).toHaveBeenCalledOnce();
  });
});
