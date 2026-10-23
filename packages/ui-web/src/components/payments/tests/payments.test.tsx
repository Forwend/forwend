import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TONES } from "../../../lib/tone";
import { ACTIVITY_DIRECTIONS, ActivityRow } from "../activity-row";
import { Money } from "../money/money";
import { NetworkWarning } from "../network-warning";
import { ReceiveAddress } from "../receive-address";
import type { PaymentStatus } from "../status-pill/payment-status";
import { PAYMENT_STATUSES } from "../status-pill/payment-status";
import { StatusPill } from "../status-pill/status-pill";

describe("Money", () => {
  it("shows 1234560000n with 6 decimals as 1,234.56 USDC in tabular figures", () => {
    const { container } = render(<Money baseUnits={1234560000n} decimals={6} token="USDC" />);
    expect(container.textContent?.replace(/\s+/g, " ").trim()).toBe("1,234.56 USDC");
    const figures = screen.getByText("1,234.56");
    expect(figures.className).toContain("tabular-nums");
  });

  it("lets a huge amount break only after its group commas", () => {
    const { container } = render(<Money baseUnits={123456789012123456n} decimals={6} />);
    expect(container.textContent).toBe("123,456,789,012.12");
    expect(container.querySelectorAll("wbr")).toHaveLength(3);
    for (const wbr of container.querySelectorAll("wbr")) {
      expect(wbr.previousSibling?.textContent).toBe(",");
    }
  });
});

describe("ActivityRow", () => {
  const row = (baseUnits: bigint, status: PaymentStatus = "confirming") =>
    render(
      <ActivityRow
        title="Withdrawal to bank"
        detail="EUR · SEPA"
        direction={ACTIVITY_DIRECTIONS.outgoing}
        amount={{ baseUnits, decimals: 6, token: "USDC" }}
        status={status}
      />,
    );

  it("shows one sign, inside the figures, even for a negative amount", () => {
    const { container, unmount } = row(-5000000n);
    expect(container.querySelector("[data-figures]")?.textContent).toBe("−5.00");
    unmount();
    expect(row(5000000n).container.querySelector("[data-figures]")?.textContent).toBe("−5.00");
  });
});

describe("pending payment statuses", () => {
  it("show detected and confirming as neutral with a turning icon, never as information or done", () => {
    for (const status of ["detected", "confirming"] as const) {
      expect(PAYMENT_STATUSES[status].tone).toBe(TONES.neutral);
      const { container } = render(<StatusPill status={status} />);
      expect(container.querySelector("svg")?.getAttribute("class")).toContain("fw-spin");
    }
    const { container } = render(<StatusPill status="paid" />);
    expect(container.querySelector("svg")?.getAttribute("class")).not.toContain("fw-spin");
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
