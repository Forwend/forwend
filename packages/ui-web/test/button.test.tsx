import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../src";

describe("Button", () => {
  it("renders a primary button by default", () => {
    render(<Button>Join waitlist</Button>);
    const button = screen.getByRole("button", { name: "Join waitlist" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.dataset.variant).toBe("primary");
  });

  it("is busy and disabled while loading", () => {
    render(<Button loading>Saving</Button>);
    const button = screen.getByRole("button", { name: "Saving" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
