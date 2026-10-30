// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TokenBalance } from "@/features/balances/types/balances";
import { OnItsWayCard } from "@/screens/dashboard/on-its-way-card";

const usdc: TokenBalance = {
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
  wallet: "2500000",
  finalizedBlock: 100,
  pending: "1000000",
  settling: "1000000",
  confirming: "0",
  partial: "0",
  held: "0",
};

describe("OnItsWayCard", () => {
  afterEach(cleanup);

  it("without prices reads a part with money as unknown and a part with none as a real zero", () => {
    render(
      <OnItsWayCard
        balances={{ tokens: [usdc], estimatedUsdTotal: null }}
        prices={undefined}
        failed={false}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByRole("link", { name: /^Moving to wallet\s*—\s*USD$/ })).toBeTruthy();
    expect(screen.getAllByText("0.00")).toHaveLength(2);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
