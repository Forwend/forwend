import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeSwitch } from "../src";

describe("ThemeSwitch", () => {
  it("toggles data-theme on <html> between light and dark", () => {
    document.documentElement.setAttribute("data-theme", "light");
    render(<ThemeSwitch />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
