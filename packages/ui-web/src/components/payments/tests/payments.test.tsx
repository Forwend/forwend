import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TONES } from "../../../lib/tone";
import { ACTIVITY_DIRECTIONS, ActivityRow } from "../activity-row";
import { Address } from "../address/address";
import { Money } from "../money/money";
import { PaymentTimeline, STEP_STATES } from "../payment-timeline";
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
    expect(container.querySelector(".font-mono")?.textContent).toBe("−5.00");
    unmount();
    expect(row(5000000n).container.querySelector(".font-mono")?.textContent).toBe("−5.00");
  });

  it("shows a confirmed transfer as plain text and a confirming one as a pill", () => {
    const confirmed = row(5000000n, "confirmed").container;
    expect(confirmed.querySelector("[data-status]")).toBeNull();
    expect(within(confirmed).getByText("Confirmed")).toBeTruthy();
    const confirming = row(5000000n, "confirming").container;
    expect(confirming.querySelector('[data-status="confirming"]')).toBeTruthy();
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
  it("renders a distinct label for each of the 12 payment statuses", () => {
    const statuses = Object.keys(PAYMENT_STATUSES) as PaymentStatus[];
    expect(statuses).toHaveLength(12);
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
    expect(new Set(labels).size).toBe(12);
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

describe("PaymentTimeline", () => {
  const bars = (container: HTMLElement) =>
    [...container.querySelectorAll("li > span:first-child > span")].map(
      (bar) => (bar as HTMLElement).style.transform || "sweep",
    );

  it("fills the current step by its progress, sweeps when the progress is unknown", () => {
    const steps = (progress?: number | null) => [
      { label: "Detected", state: STEP_STATES.complete },
      { label: "Confirming", state: STEP_STATES.current, progress },
      { label: "Paid", state: STEP_STATES.upcoming },
    ];
    const known = render(<PaymentTimeline label="Known" steps={steps(0.25)} />);
    expect(bars(known.container)).toEqual(["scaleX(1)", "scaleX(0.25)", "scaleX(0)"]);
    const unknown = render(<PaymentTimeline label="Unknown" steps={steps(null)} />);
    expect(bars(unknown.container)).toEqual(["scaleX(1)", "sweep", "scaleX(0)"]);
    const plain = render(<PaymentTimeline label="Plain" steps={steps()} />);
    expect(bars(plain.container)).toEqual(["scaleX(1)", "scaleX(1)", "scaleX(0)"]);
  });

  it("shows a toned step's label as a tinted badge", () => {
    const { getByText } = render(
      <PaymentTimeline
        label="Toned"
        steps={[
          { label: "Partly paid", state: STEP_STATES.current, progress: 0.5, tone: "warning" },
        ]}
      />,
    );
    expect(getByText("Partly paid").getAttribute("class")).toContain("bg-warning-soft");
  });
});
