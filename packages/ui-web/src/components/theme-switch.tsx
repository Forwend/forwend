"use client";

import type { Theme } from "@forwend/design-tokens";
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY, THEMES } from "@forwend/design-tokens";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cx } from "../lib/cx";
import type { ThemeSwitchProps } from "../types/ui/theme-switch";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function readTheme(): Theme {
  return document.documentElement.getAttribute(THEME_ATTRIBUTE) === THEMES.dark
    ? THEMES.dark
    : THEMES.light;
}

// Only "light" or "dark" count as a choice, the same rule as THEME_INIT_SCRIPT.
function saved(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === THEMES.light || value === THEMES.dark ? value : null;
  } catch {
    return null;
  }
}

// THEME_INIT_SCRIPT sets the theme before paint; this button changes it and remembers the choice.
export function ThemeSwitch({ className }: ThemeSwitchProps) {
  const [theme, setTheme] = useState<Theme>(THEMES.light);

  useEffect(() => {
    setTheme(readTheme());
    // With no saved choice, keep following the system when it changes.
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      if (saved()) return;
      const next = media.matches ? THEMES.dark : THEMES.light;
      document.documentElement.setAttribute(THEME_ATTRIBUTE, next);
      setTheme(next);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const next = theme === THEMES.dark ? THEMES.light : THEMES.dark;

  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.setAttribute(THEME_ATTRIBUTE, next);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          // Storage blocked: the switch still works for this page view.
        }
        setTheme(next);
      }}
      aria-label={`Switch to ${next} theme`}
      className={cx(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-pill border border-line bg-surface text-ink shadow-sm transition-colors duration-[var(--fw-duration-fast)] ease-out hover:bg-surface-2",
        className,
      )}
    >
      {/* Icons follow data-theme through CSS, so they are right before hydration too. */}
      <Sun aria-hidden className="hidden size-[var(--fw-icon-md)] dark:block" />
      <Moon aria-hidden className="size-[var(--fw-icon-md)] dark:hidden" />
    </button>
  );
}
