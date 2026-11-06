import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, HoldButton } from "../hold-button";

describe("HoldButton", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("acts only once the press has lasted the whole hold", () => {
    const onHold = vi.fn();
    render(<HoldButton onHold={onHold}>Hold to send</HoldButton>);
    const button = screen.getByRole("button", { name: "Hold to send" });
    // A mouse click (detail 1) is a press let go at once.
    fireEvent.click(button, { detail: 1 });
    fireEvent.pointerDown(button, { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_MS - 1));
    fireEvent.pointerUp(button);
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHold).not.toHaveBeenCalled();

    fireEvent.pointerDown(button, { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it("holds from the keyboard, and Enter alone never acts", () => {
    const onHold = vi.fn();
    render(<HoldButton onHold={onHold}>Hold to send</HoldButton>);
    const button = screen.getByRole("button", { name: "Hold to send" });
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyUp(button, { key: "Enter" });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHold).not.toHaveBeenCalled();

    fireEvent.keyDown(button, { key: " " });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it("acts on a screen reader's activate, a click with no press before it", () => {
    const onHold = vi.fn();
    render(<HoldButton onHold={onHold}>Hold to send</HoldButton>);
    fireEvent.click(screen.getByRole("button", { name: "Hold to send" }), { detail: 0 });
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it("can't be held while disabled", () => {
    const onHold = vi.fn();
    render(
      <HoldButton onHold={onHold} disabled>
        Hold to send
      </HoldButton>,
    );
    fireEvent.pointerDown(screen.getByRole("button"), { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHold).not.toHaveBeenCalled();
  });
});
