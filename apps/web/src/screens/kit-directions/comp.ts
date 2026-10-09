import type { CSSProperties } from "react";

export const NAV_VARIANTS = {
  pill: "pill",
  bar: "bar",
} as const;

/** CSS custom properties a comp sets for its children (`--ink`, `--muted`, ...). */
export type CompVars = CSSProperties & Record<`--${string}`, string>;

export type NavVariant = (typeof NAV_VARIANTS)[keyof typeof NAV_VARIANTS];

export function compVars(ui: Readonly<Record<string, string>>): CompVars {
  return Object.fromEntries(Object.entries(ui).map(([k, v]) => [`--${k}`, v])) as CompVars;
}

// UI colors used only by the three direction comps until F004 turns the chosen one into tokens.
export const COMP_UI = {
  dawn: {
    ink: "#0F2219",
    muted: "#33493F",
    line: "rgba(15, 34, 25, 0.12)",
    surface: "rgba(255, 255, 255, 0.72)",
    accent: "#2C6E91",
    onInk: "#F5FAF7",
  },
  dusk: {
    ink: "#F4EEE8",
    muted: "#DDD3CC",
    line: "rgba(255, 255, 255, 0.10)",
    surface: "#17151E",
    accent: "#E9A26B",
    onInk: "#17151E",
    scrim: "rgba(13, 12, 17, 0.78)",
  },
  halftone: {
    ink: "#0D1530",
    muted: "#46517A",
    line: "#D3DAEA",
    surface: "#FFFFFF",
    accent: "#1F44D6",
    onInk: "#FFFFFF",
  },
} as const;
