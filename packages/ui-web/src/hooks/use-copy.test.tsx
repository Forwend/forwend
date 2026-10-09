import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Address } from "../components/payments/address";

const address = "0x1234567890abcdef1234567890abcdef12345678";

describe("copy helper", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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
