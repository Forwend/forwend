import type { CSSProperties } from "react";
import type { NAV_VARIANTS } from "@/constants/comp";

/** CSS custom properties a comp sets for its children (`--ink`, `--muted`, ...). */
export type CompVars = CSSProperties & Record<`--${string}`, string>;

export type NavVariant = (typeof NAV_VARIANTS)[keyof typeof NAV_VARIANTS];
