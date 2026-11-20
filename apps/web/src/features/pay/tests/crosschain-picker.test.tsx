// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CrossChainPicker } from "@/features/pay/components/crosschain-picker";
import { crossTokensSchema } from "@/features/pay/schemas/crosschain";
import type { CrossToken } from "@/features/pay/types/crosschain";

afterEach(cleanup);

const token = (t: Partial<CrossToken> & Pick<CrossToken, "blockchain" | "symbol">): CrossToken => ({
  assetId: `${t.blockchain}:${t.symbol}`,
  decimals: 6,
  contract: null,
  priceUsd: "1",
  estimate: null,
  ...t,
});

const TOKENS = [
  token({
    blockchain: "eth",
    symbol: "ETH",
    decimals: 18,
    priceUsd: "2143.49",
    estimate: "583161106420370517",
  }),
  token({ blockchain: "tron", symbol: "USDT", priceUsd: "0.9991", estimate: "1251126013" }),
  token({
    blockchain: "tron",
    symbol: "USDC",
    priceUsd: "1",
    estimate: "1250000000",
    minimum: "5000000000",
  }),
  token({ blockchain: "abs", symbol: "FOO", priceUsd: "0.5", estimate: "2500000001" }),
];

function open(tokens: readonly CrossToken[] = TOKENS) {
  render(
    <CrossChainPicker
      open
      onOpenChange={() => {}}
      tokens={tokens}
      due={1_250_000_000n}
      dueDecimals={6}
      onPick={() => {}}
    />,
  );
}

const row = (name: RegExp) => screen.getByRole("button", { name });

describe("CrossChainPicker", () => {
  it("lets no one pick a token that needs more than is due", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Tron" }));
    expect(row(/^USDC/)).toHaveProperty("disabled", true);
    expect(row(/^USDT/)).toHaveProperty("disabled", false);
  });

  it("takes a token's id only in CoinGecko's own form, so it can name nothing but a logo file", () => {
    const list = (coingeckoId: unknown) =>
      crossTokensSchema.safeParse({
        due: "1",
        decimals: 6,
        tokens: [{ ...TOKENS[0], coingeckoId }],
      }).success;
    expect(list("usd-coin")).toBe(true);
    expect(list(null)).toBe(true);
    expect(list("../../secret")).toBe(false);
    expect(list("https://example.com/logo.png")).toBe(false);
  });

  it("rounds About up as the amount to send is", () => {
    open();
    expect(row(/^ETH/).textContent).toContain("About 0.58317 ETH");
    fireEvent.click(screen.getByRole("button", { name: "Tron" }));
    expect(row(/^USDT/).textContent).toContain("About 1,251.13 USDT");
    fireEvent.click(screen.getByRole("button", { name: "Abstract" }));
    expect(row(/^FOO/).textContent).toContain("About 2,500.10 FOO");
  });
});
