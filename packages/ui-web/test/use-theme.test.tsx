import { THEME_ATTRIBUTE, THEMES } from "@forwend/design-tokens";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "../src";

function Probe({ id }: { id: string }) {
  const [theme, setTheme] = useTheme();
  return (
    <button type="button" data-testid={id} onClick={() => setTheme(THEMES.dark)}>
      {theme}
    </button>
  );
}

describe("useTheme", () => {
  beforeEach(() => {
    // jsdom has no matchMedia; the hook follows the system preference through it.
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    document.documentElement.setAttribute(THEME_ATTRIBUTE, THEMES.light);
  });

  it("keeps two switches on one page in agreement", async () => {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, THEMES.light);
    render(
      <>
        <Probe id="a" />
        <Probe id="b" />
      </>,
    );
    await act(async () => screen.getByTestId("a").click());
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe(THEMES.dark);
    expect(screen.getByTestId("b").textContent).toBe(THEMES.dark);
  });
});
