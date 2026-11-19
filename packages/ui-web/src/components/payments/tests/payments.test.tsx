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

  it("shows and copies the whole address", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    const { container } = render(<ReceiveAddress address={address} />);
    expect(container.querySelector("[data-address]")?.textContent).toBe(address);
    await user.click(screen.getByRole("button", { name: "Copy address" }));
    expect(writeText).toHaveBeenCalledWith(address);
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
