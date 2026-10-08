"use client";

import type { Theme } from "@forwend/design-tokens";
import { THEME_ATTRIBUTE, THEMES } from "@forwend/design-tokens";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

// Toggles data-theme on <html>. The choice is not stored; the app shell adds persistence later.
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(THEMES.light);

  useEffect(() => {
    const current = document.documentElement.getAttribute(THEME_ATTRIBUTE);
    setTheme(current === THEMES.dark ? THEMES.dark : THEMES.light);
  }, []);

  const next = theme === THEMES.dark ? THEMES.light : THEMES.dark;

  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.setAttribute(THEME_ATTRIBUTE, next);
        setTheme(next);
      }}
      aria-label={`Switch to ${next} theme`}
      className="inline-flex size-10 items-center justify-center rounded-pill border border-line bg-surface text-ink shadow-sm transition-colors duration-[var(--fw-duration-fast)] ease-out hover:bg-surface-2"
    >
      {theme === THEMES.dark ? (
        <Sun aria-hidden className="size-[var(--fw-icon-md)]" />
      ) : (
        <Moon aria-hidden className="size-[var(--fw-icon-md)]" />
      )}
    </button>
  );
}
