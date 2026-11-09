// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CrossChainPicker } from "@/features/pay/components/crosschain-picker";
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

function open() {
  render(
    <CrossChainPicker
      open
      onOpenChange={() => {}}
      tokens={TOKENS}
      due={1_250_000_000n}
      dueDecimals={6}
      onPick={() => {}}
    />,
  );
}

const row = (name: RegExp) => screen.getByRole("button", { name });

// R-246: 1Click names no logos; popular chains and their own tokens get ours, the rest a first letter.
describe("CrossChainPicker", () => {
  it("shows logos for popular chains and their tokens, and a first letter for any other", () => {
    open();
    expect(screen.getByRole("button", { name: "Ethereum" }).querySelector("svg")).not.toBeNull();
    const abstract = screen.getByRole("button", { name: "Abstract" });
    expect(abstract.querySelector("svg")).toBeNull();
    expect(abstract.textContent).toBe("AAbstract");
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
