// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BalanceFigure } from "@/features/balances/balance-figure";
import type { Balances, TokenBalance } from "@/features/balances/balances";
import { MoneyActions } from "@/features/balances/money-actions";

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
  return render(<BalanceFigure balances={balances} failed={failed} onRetry={() => {}} />);
}

describe("BalanceFigure", () => {
  afterEach(cleanup);

  it("shows the total in USD, marked as an estimate, also for a single stablecoin", () => {
    show({ tokens: [usdc], estimatedUsdTotal: "2.50" });
    expect(screen.getByText("2.50").closest("p")?.textContent).toBe("2.50USD");
    expect(
      screen.getByRole("button", { name: /^Estimated: each stablecoin counts as 1 USD/ }),
    ).toBeTruthy();
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
    expect(screen.getByText(/on its way/).textContent).toContain("1.00");
    expect(screen.getByText(/held for payers/).textContent).toContain("0.25");
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

  it("offers a retry when the balances could not be loaded", () => {
    show(null, { failed: true });
    expect(screen.getByRole("alert").textContent).toContain("We could not load the balances.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("MoneyActions", () => {
  afterEach(cleanup);

  it("only Receive works; Send, Transfer and Withdraw say why in their name and do nothing", () => {
    const onReceive = vi.fn();
    render(<MoneyActions onReceive={onReceive} />);
    fireEvent.click(screen.getByRole("button", { name: "Receive" }));
    expect(onReceive).toHaveBeenCalledOnce();
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
  });
});
