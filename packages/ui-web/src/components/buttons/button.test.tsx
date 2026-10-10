import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  afterEach(() => cleanup());

  it("renders a primary button by default", () => {
    render(<Button>Join waitlist</Button>);
    const button = screen.getByRole("button", { name: "Join waitlist" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.dataset.variant).toBe("primary");
  });

  it("is busy and ignores clicks while loading, without looking disabled", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Saving" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    // Only the spinner shows; the label keeps the width and the name.
    expect(button.querySelector("[data-loading-label]")?.className).toContain("opacity-0");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
