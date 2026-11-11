// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BalancesList } from "@/features/balances/components/balances-list";
import type { TokenBalance } from "@/features/balances/types/balances";
import type { TokenPrice } from "@/features/prices/types/prices";

const usdc: TokenBalance = {
  chainId: 84532,
  token: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  symbol: "USDC",
  decimals: 6,
  wallet: "12400100000",
  finalizedBlock: 100,
  pending: "200000",
  settling: "200000",
  held: "750000",
};
const now = new Date().toISOString();
const price: TokenPrice = {
  chainId: usdc.chainId,
  token: usdc.token,
  symbol: "USDC",
  coinId: "usd-coin",
  usd: "1",
  sourceUpdatedAt: now,
  fetchedAt: now,
  stale: false,
};

describe("BalancesList", () => {
  afterEach(cleanup);

  it("shows the wallet amount with its unit and USD value, then each kind of money on its way or on hold", () => {
    render(
      <BalancesList
        balances={{ tokens: [usdc], estimatedUsdTotal: "12400.10" }}
        prices={[price]}
        failed={false}
        onRetry={() => {}}
      />,
    );
    const row = within(screen.getByRole("listitem"));
    expect(row.getByText("12,400.10").closest("[data-money]")?.textContent).toBe("12,400.10 USDC");
    expect(row.getByText("12,400.10 USD")).toBeTruthy();
    expect(row.getByText("Moving to wallet").nextSibling?.textContent).toBe("0.20");
    expect(row.getByText("On hold").nextSibling?.textContent).toBe("0.75");
    expect(row.getByText(/^Not final/).parentElement?.textContent).toBe("Not final: —");
  });
});
