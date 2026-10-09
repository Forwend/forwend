// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MoneySummary } from "@/components/app/money-summary";
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

function show(balances: Balances | null, failed = false) {
  return render(
    <MoneySummary balances={balances} failed={failed} updatedAt={null} onRetry={() => {}} />,
  );
}

describe("MoneySummary", () => {
  afterEach(cleanup);

  it("leads with the wallet amount in the token's decimals and names the network", () => {
    show({ tokens: [usdc], estimatedUsdTotal: "2.50" });
    expect(screen.getByText("2.50").closest("[data-money]")?.textContent).toContain("USDC");
    expect(screen.getByText("In this profile's wallet on Base Sepolia")).toBeTruthy();
    // One token: the USD estimate would only repeat the amount.
    expect(screen.queryByText(/Estimated total/)).toBeNull();
  });

  it("shows pending and held apart from the wallet, each only when there is some", () => {
    const { rerender } = show({ tokens: [usdc], estimatedUsdTotal: "2.50" });
    expect(screen.queryByText(/on its way/)).toBeNull();
    expect(screen.queryByText(/held for payers/)).toBeNull();
    rerender(
      <MoneySummary
        balances={{
          tokens: [{ ...usdc, pending: "1000000", held: "250000" }],
          estimatedUsdTotal: "2.50",
        }}
        failed={false}
        updatedAt={null}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/on its way/).textContent).toContain("1.00");
    expect(screen.getByText(/held for payers/).textContent).toContain("0.25");
  });

  it("marks the total as an estimate with several tokens, and never shows a made-up 0", () => {
    const usdt = {
      ...usdc,
      token: "0x2222222222222222222222222222222222222222",
      symbol: "USDT",
      wallet: null,
    };
    show({ tokens: [usdc, usdt], estimatedUsdTotal: null });
    expect(screen.getByText(/Estimated total/).textContent).toContain("—");
    expect(screen.getByText(/each stablecoin counted as 1 USD/)).toBeTruthy();
    expect(
      screen.getByText("We could not read this balance just now. It updates on its own."),
    ).toBeTruthy();
  });

  it("offers a retry when the balances could not be loaded", () => {
    show(null, true);
    expect(screen.getByRole("alert").textContent).toContain("We could not load the balances.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
