import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeSwitch } from "../src";

describe("ThemeSwitch", () => {
  beforeEach(() => {
    // jsdom has no matchMedia; the switch listens to the system preference through it.
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    localStorage.clear();
    document.documentElement.setAttribute("data-theme", "light");
  });

  afterEach(() => cleanup());

  it("toggles data-theme on <html> between light and dark", () => {
    render(<ThemeSwitch />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("remembers the choice in localStorage", () => {
    render(<ThemeSwitch />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(localStorage.getItem("fw-theme")).toBe("dark");
  });
});
