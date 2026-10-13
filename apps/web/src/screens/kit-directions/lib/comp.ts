import type { CompVars } from "@/screens/kit-directions/types/comp";

export function compVars(ui: Readonly<Record<string, string>>): CompVars {
  return Object.fromEntries(Object.entries(ui).map(([k, v]) => [`--${k}`, v])) as CompVars;
}
