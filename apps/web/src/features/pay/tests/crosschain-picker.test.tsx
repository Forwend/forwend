// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CrossChainPicker } from "@/features/pay/components/crosschain-picker";
import { crossTokensSchema } from "@/features/pay/schemas/crosschain";
import type { CrossToken } from "@/features/pay/types/crosschain";

afterEach(cleanup);
// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.open = true;
};

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

// R-246: 1Click names no logos; popular chains and their own tokens get ours, the rest a first letter.
describe("CrossChainPicker", () => {
  it("shows drawn logos for popular chains and tokens, shipped files for others, and a first letter for the rest", () => {
    open([...TOKENS, token({ blockchain: "qtc", symbol: "QTC" })]);
    // A drawn logo is a brand drawing; the row's chevron is an interface icon and says nothing of the network.
    const drawn = "svg:not(.lucide)";
    expect(screen.getByRole("button", { name: "Ethereum" }).querySelector(drawn)).not.toBeNull();
    // Abstract has no drawing: the web ships its logo as a file (R-250).
    const abstract = screen.getByRole("button", { name: "Abstract" });
    expect(abstract.querySelector(drawn)).toBeNull();
    expect(abstract.querySelector("img")?.getAttribute("src")).toBe("/logos/chains/abs.webp");
    // A network with neither shows its first letter.
    const other = screen.getByRole("button", { name: "QTC" });
    expect(other.querySelector(drawn)).toBeNull();
    expect(other.querySelector("img")).toBeNull();
    expect(other.textContent?.startsWith("QQTC")).toBe(true);
    expect(row(/^ETH/).querySelector("svg")).not.toBeNull();
    fireEvent.click(abstract);
    expect(row(/^FOO/).querySelector("svg")).toBeNull();
    expect(row(/^FOO/).textContent?.startsWith("FFOO")).toBe(true);
  });

  it("greys the logo of a token that needs more than is due (R-242)", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Tron" }));
    const blocked = row(/^USDC/);
    expect(blocked).toHaveProperty("disabled", true);
    expect(blocked.querySelector("svg")?.getAttribute("class")).toContain("grayscale");
    expect(row(/^USDT/).querySelector("svg")?.getAttribute("class")).not.toContain("grayscale");
  });

  // R-250: a token Forwend draws no logo for shows the file the web ships, from Forwend's own origin.
  it("shows the shipped logo for a token without a drawn one, and its letter when there is none or it fails", () => {
    open([
      token({ blockchain: "abs", symbol: "FOO", coingeckoId: "aave" }),
      token({ blockchain: "abs", symbol: "BAR", coingeckoId: "no-such-file" }),
      token({ blockchain: "eth", symbol: "ETH", coingeckoId: "ethereum" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Abstract" }));
    const image = row(/^FOO/).querySelector("img");
    expect(image?.getAttribute("src")).toBe("/logos/tokens/aave.webp");
    // No file is asked for an id the web ships none for.
    expect(row(/^BAR/).querySelector("img")).toBeNull();
    expect(row(/^BAR/).textContent?.startsWith("BBAR")).toBe(true);
    if (image) fireEvent.error(image);
    expect(row(/^FOO/).querySelector("img")).toBeNull();
    expect(row(/^FOO/).textContent?.startsWith("FFOO")).toBe(true);
    // A logo Forwend draws itself stays: the file is for the tokens it draws none for.
    fireEvent.click(screen.getByRole("button", { name: "Ethereum" }));
    expect(row(/^ETH/).querySelector("img")).toBeNull();
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

  // R-244: About rounds up as You send does: a stablecoin to the cent, another token to 5 significant digits.
  it("rounds About up as the amount to send is", () => {
    open();
    expect(row(/^ETH/).textContent).toContain("About 0.58317 ETH");
    fireEvent.click(screen.getByRole("button", { name: "Tron" }));
    expect(row(/^USDT/).textContent).toContain("About 1,251.13 USDT");
    fireEvent.click(screen.getByRole("button", { name: "Abstract" }));
    expect(row(/^FOO/).textContent).toContain("About 2,500.10 FOO");
  });
});
