import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Address } from "../../components/payments/address/address";
import { COPIED_LABEL_MS } from "../use-copy";

const address = "0x1234567890abcdef1234567890abcdef12345678";

describe("copy helper", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns to idle after copying, but keeps a failure until the next attempt", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<Address address={address} />);
    await user.click(screen.getByRole("button", { name: "Copy address" }));
    act(() => vi.advanceTimersByTime(COPIED_LABEL_MS));
    expect(screen.getByRole("button", { name: "Copy address" })).toBeTruthy();

    writeText.mockRejectedValue(new Error("denied"));
    await user.click(screen.getByRole("button", { name: "Copy address" }));
    act(() => vi.advanceTimersByTime(COPIED_LABEL_MS * 2));
    expect(
      screen.getByRole("button", { name: "Copy failed: select the address instead" }),
    ).toBeTruthy();
  });

  it("says the copy failed, and throws nothing, when the clipboard write fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    render(<Address address={address} />);
    await user.click(screen.getByRole("button", { name: "Copy address" }));
    expect(
      screen.getByRole("button", { name: "Copy failed: select the address instead" }),
    ).toBeTruthy();
  });

  it("clears its timer when the component unmounts", async () => {
    const user = userEvent.setup();
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = render(<Address address={address} />);
    await user.click(screen.getByRole("button", { name: "Copy address" }));
    expect(screen.getByRole("button", { name: "Address copied" })).toBeTruthy();
    const before = clear.mock.calls.length;
    act(() => unmount());
    expect(clear.mock.calls.length).toBeGreaterThan(before);
  });
});
