"use client";

import { THEME_ATTRIBUTE, THEME_STORAGE_KEY, THEMES, type Theme } from "@forwend/design-tokens";
import { useSyncExternalStore } from "react";

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

// Transitions are off while the theme flips, so the page changes at once, not in pieces.
function applyTheme(theme: Theme) {
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.append(style);
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
  void getComputedStyle(document.documentElement).color;
  style.remove();
}

// data-theme on <html> is the one source, so every switch on a page agrees.
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [THEME_ATTRIBUTE],
  });
  const media = window.matchMedia(DARK_QUERY);
  const onSystem = () => {
    if (!saved()) applyTheme(media.matches ? THEMES.dark : THEMES.light);
  };
  media.addEventListener("change", onSystem);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onSystem);
  };
}

/** The setter also takes a function of the theme on the page right now, for a toggle pressed twice quickly. */
export function useTheme(): [Theme, (theme: Theme | ((current: Theme) => Theme)) => void] {
  const theme = useSyncExternalStore(subscribe, readTheme, () => THEMES.light);
  const setTheme = (choice: Theme | ((current: Theme) => Theme)) => {
    const next = typeof choice === "function" ? choice(readTheme()) : choice;
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the theme still changes for this page view.
    }
  };
  return [theme, setTheme];
}
