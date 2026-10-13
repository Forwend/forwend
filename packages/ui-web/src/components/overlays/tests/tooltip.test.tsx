import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Tooltip, TooltipProvider } from "../tooltip";

describe("Tooltip", () => {
  // jsdom has no ResizeObserver; Radix measures the open tooltip with it.
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });
  afterEach(() => cleanup());

  it("opens on a tap, since touch has no hover", () => {
    render(
      <Tooltip content="Coming soon">
        <button type="button">Send</button>
      </Tooltip>,
      { wrapper: TooltipProvider },
    );
    const trigger = screen.getByRole("button", { name: "Send" });
    fireEvent.pointerDown(trigger, { pointerType: "touch" });
    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip").textContent).toBe("Coming soon");
  });
});
