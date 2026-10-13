import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeSwitch } from "../theme-switch";

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

  // The accessible name is CSS-driven (dark: variant); browser tests check it, jsdom has no Tailwind CSS.

  it("toggles data-theme on <html> between light and dark", () => {
    render(<ThemeSwitch />);
    fireEvent.click(screen.getByRole("button"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    fireEvent.click(screen.getByRole("button"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    // Transitions are off only while the theme changes.
    expect(document.head.querySelector("style")).toBeNull();
  });

  it("remembers the choice in localStorage", () => {
    render(<ThemeSwitch />);
    fireEvent.click(screen.getByRole("button"));
    expect(localStorage.getItem("fw-theme")).toBe("dark");
  });
});
