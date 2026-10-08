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
});
