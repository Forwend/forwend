// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BalanceCard } from "@/components/app/balance-card";
import type { Balances, TokenBalance } from "@/types/app/money";

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

function show(balances: Balances | null, { failed = false, onReceive = () => {} } = {}) {
  return render(
    <BalanceCard
      balances={balances}
      failed={failed}
      updatedAt={null}
      onRetry={() => {}}
      onReceive={onReceive}
    />,
  );
}

describe("BalanceCard", () => {
  afterEach(cleanup);

  it("shows one token's amount in its own unit and decimals, with its network", () => {
    show({ tokens: [usdc], estimatedUsdTotal: "2.50" });
    expect(screen.getByText("2.50").closest("p")?.textContent).toContain("USDC");
    expect(screen.getByText("In the wallet on Base Sepolia")).toBeTruthy();
    expect(screen.queryByText(/Estimated in USD/)).toBeNull();
  });

  it("shows pending and held apart from the wallet, each only when there is some", () => {
    const { rerender } = show({ tokens: [usdc], estimatedUsdTotal: "2.50" });
    expect(screen.queryByText(/on its way/)).toBeNull();
    expect(screen.queryByText(/held for payers/)).toBeNull();
    rerender(
      <BalanceCard
        balances={{
          tokens: [{ ...usdc, pending: "1000000", held: "250000" }],
          estimatedUsdTotal: "2.50",
        }}
        failed={false}
        updatedAt={null}
        onRetry={() => {}}
        onReceive={() => {}}
      />,
    );
    expect(screen.getByText(/on its way/).textContent).toContain("1.00");
    expect(screen.getByText(/held for payers/).textContent).toContain("0.25");
  });

  it("marks a several-token total as a USD estimate, and never shows a made-up 0", () => {
    const usdt = {
      ...usdc,
      chainId: 421614,
      token: "0x2222222222222222222222222222222222222222",
      symbol: "USDT",
    };
    const { rerender } = show({ tokens: [usdc, usdt], estimatedUsdTotal: "5.00" });
    expect(screen.getByText(/≈ 5.00/)).toBeTruthy();
    expect(screen.getByText(/Estimated in USD.*across 2 networks/)).toBeTruthy();
    rerender(
      <BalanceCard
        balances={{ tokens: [usdc, { ...usdt, wallet: null }], estimatedUsdTotal: null }}
        failed={false}
        updatedAt={null}
        onRetry={() => {}}
        onReceive={() => {}}
      />,
    );
    expect(screen.getByText(/—/)).toBeTruthy();
    expect(screen.queryByText(/≈ 0/)).toBeNull();
  });

  it("only Receive works; Send, Transfer and Withdraw say they are coming", () => {
    const onReceive = vi.fn();
    show({ tokens: [usdc], estimatedUsdTotal: "2.50" }, { onReceive });
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
      // A press (touch has no hover title) shows the reason in the card and announces it.
      fireEvent.click(button);
      expect(screen.getByRole("status").textContent).toContain(reason);
    }
    expect(onReceive).toHaveBeenCalledOnce();
  });

  it("offers a retry when the balances could not be loaded", () => {
    show(null, { failed: true });
    expect(screen.getByRole("alert").textContent).toContain("We could not load the balances.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
