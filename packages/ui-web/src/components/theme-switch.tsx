"use client";

import { THEMES } from "@forwend/design-tokens";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/use-theme";
import { cx } from "../lib/cx";
import type { ThemeSwitchProps } from "../types/ui/theme-switch";

// THEME_INIT_SCRIPT sets the theme before paint; this button changes it and remembers the choice.
export function ThemeSwitch({ className }: ThemeSwitchProps) {
  // The icon and name follow data-theme through CSS, so the switch only needs the setter.
  const [, setTheme] = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme((current) => (current === THEMES.dark ? THEMES.light : THEMES.dark))}
      className={cx(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-pill border border-line bg-surface text-ink shadow-sm transition-colors duration-[var(--fw-duration-fast)] ease-out hover:bg-surface-2",
        className,
      )}
    >
      {/* Icons and the accessible name follow data-theme through CSS, so both are right before hydration. */}
      <Sun aria-hidden className="hidden size-[var(--fw-icon-md)] dark:block" />
      <Moon aria-hidden className="size-[var(--fw-icon-md)] dark:hidden" />
      <span className="sr-only dark:hidden">Switch to dark theme</span>
      <span className="sr-only hidden dark:inline">Switch to light theme</span>
    </button>
  );
}
