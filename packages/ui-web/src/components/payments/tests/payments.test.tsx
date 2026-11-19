import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ACTIVITY_DIRECTIONS, ActivityRow } from "../activity-row";
import { FullAddress } from "../address/full-address";
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

  it("marks the ends of the whole address, and selects, reads and copies as the address (R-78)", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    const { container } = render(<ReceiveAddress address={address} />);
    const shown = container.querySelector("[data-address]") as HTMLElement;
    // No character between the parts: a selection, a copy or a screen reader gets the address itself.
    expect(shown.textContent).toBe(address);
    const parts = Array.from(shown.children, (part) => part.textContent);
    expect(parts[0]).toBe("0x5861");
    expect(parts.at(-1)).toBe("0078");
    expect(shown.children[0]?.className).toContain("text-ink");
    expect(shown.children[2]?.className).toContain("text-ink");
    expect(shown.children[1]?.className).not.toContain("text-ink");
    // Nothing is hidden at any width: a shortened address is what look-alikes copy.
    for (const part of shown.children) expect(part.className).not.toMatch(/sr-only|hidden/);
    await user.click(screen.getByRole("button", { name: "Copy address" }));
    expect(writeText).toHaveBeenCalledWith(address);
    expect(container.querySelector("p[role=status]")?.textContent).toBe("Address copied");
  });
});

// Address poisoning copies an address's start and end: the address checked before money moves shows every character.
describe("FullAddress", () => {
  it("shows and announces every character of the address", () => {
    const address = "0x1234abcd5678ef901234abcd5678ef901234abcd";
    const { container } = render(<FullAddress address={address} />);
    const shown = container.querySelector("[aria-hidden]")?.textContent;
    expect(shown).toBe(address);
    expect(screen.getByText(address)).toBeTruthy();
  });
});
