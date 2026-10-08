import type { THEMES } from "../../constants/themes";

export type Theme = (typeof THEMES)[keyof typeof THEMES];
