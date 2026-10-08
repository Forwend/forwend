import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PaymentStatus } from "../src";
import { Address, Money, PAYMENT_STATUSES, StatusPill } from "../src";

describe("Money", () => {
  it("shows 1234560000n with 6 decimals as 1,234.56 USDC in tabular figures", () => {
    const { container } = render(<Money baseUnits={1234560000n} decimals={6} token="USDC" />);
    expect(container.textContent?.replace(/\s+/g, " ").trim()).toBe("1,234.56 USDC");
    const figures = screen.getByText("1,234.56");
    expect(figures.className).toContain("tabular-nums");
  });
});

describe("Address", () => {
  const address = "0x1234567890abcdef1234567890abcdef12345678";

  it("shows the short form and copies the full address", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<Address address={address} />);
    expect(screen.getByText("0x1234…5678")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy address" }));
    expect(writeText).toHaveBeenCalledWith(address);
    expect(screen.getByRole("button", { name: "Address copied" })).toBeTruthy();
  });
});

describe("StatusPill", () => {
  it("renders a distinct label for each of the 10 payment statuses", () => {
    const statuses = Object.keys(PAYMENT_STATUSES) as PaymentStatus[];
    expect(statuses).toHaveLength(10);
    const { container } = render(
      <div>
        {statuses.map((status) => (
          <StatusPill key={status} status={status} />
        ))}
      </div>,
    );
    const labels = statuses.map(
      (status) =>
        within(container.querySelector(`[data-status="${status}"]`) as HTMLElement).getByText(/.+/)
          .textContent,
    );
    expect(labels).toEqual(statuses.map((s) => PAYMENT_STATUSES[s].label));
    expect(new Set(labels).size).toBe(10);
  });
});
