import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ACTIVITY_DIRECTIONS, ActivityRow } from "../activity-row";
import { FullAddress } from "../address/full-address";
import { NetworkWarning } from "../network-warning";
import { ReceiveAddress } from "../receive-address";

describe("ActivityRow", () => {
  const row = (baseUnits: bigint) =>
    render(
      <ActivityRow
        title="Withdrawal to bank"
        detail="EUR · SEPA"
        direction={ACTIVITY_DIRECTIONS.outgoing}
        amount={{ baseUnits, decimals: 6, token: "USDC" }}
        status="confirming"
      />,
    );

  it("shows one sign, inside the figures, even for a negative amount", () => {
    const { container, unmount } = row(-5000000n);
    expect(container.querySelector("[data-figures]")?.textContent).toBe("−5.00");
    unmount();
    expect(row(5000000n).container.querySelector("[data-figures]")?.textContent).toBe("−5.00");
  });
});

describe("ReceiveAddress", () => {
  const address = "0x586134f74b654f5835860ca198ae725344670078";

  it("shows and copies the whole address", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    const { container } = render(<ReceiveAddress address={address} />);
    expect(container.querySelector("[data-address]")?.textContent).toBe(address);
    await user.click(screen.getByRole("button", { name: "Copy address" }));
    expect(writeText).toHaveBeenCalledWith(address);
  });

  // Look-alike addresses copy the ends, so the start and end groups stand apart from the middle.
  it("marks the start and end groups of the whole address", () => {
    const { container } = render(<ReceiveAddress address={address} />);
    const shown = container.querySelector("[data-address]") as HTMLElement;
    const parts = Array.from(shown.children, (part) => part.textContent);
    expect(parts[0]).toBe("0x5861");
    expect(parts.at(-1)).toBe("0078");
  });
});

describe("NetworkWarning", () => {
  it("names a bridged look-alike only when the network has one", () => {
    const { container, rerender } = render(
      <NetworkWarning token="USDC" network="Arbitrum Sepolia" lookalike="USDC.e" />,
    );
    expect(container.textContent).toContain(
      "Send only USDC on Arbitrum Sepolia. Native USDC, not USDC.e.",
    );
    rerender(<NetworkWarning token="USDC" network="Base Sepolia" />);
    expect(container.textContent).not.toContain("Native");
  });
});

describe("FullAddress", () => {
  it("shows and announces every character of the address", () => {
    const address = "0x1234abcd5678ef901234abcd5678ef901234abcd";
    const { container } = render(<FullAddress address={address} />);
    const shown = container.querySelector("[aria-hidden]")?.textContent;
    expect(shown).toBe(address);
    expect(screen.getByText(address)).toBeTruthy();
  });
});
