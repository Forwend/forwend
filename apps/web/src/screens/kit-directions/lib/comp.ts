import type { CSSProperties } from "react";

export function compVars(ui: Readonly<Record<string, string>>): CSSProperties {
  return Object.fromEntries(Object.entries(ui).map(([k, v]) => [`--${k}`, v]));
}
