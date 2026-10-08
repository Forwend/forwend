import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND_COLORS, BRAND_COLORS_DARK } from "@/constants/brand-colors";

const css = readFileSync(
  new URL("../../../packages/design-tokens/src/tokens.css", import.meta.url),
  "utf8",
);
const light = css.slice(
  css.indexOf('[data-theme="light"] {'),
  css.indexOf("}", css.indexOf('[data-theme="light"] {')),
);

describe("BRAND_COLORS", () => {
  it.each(Object.entries(BRAND_COLORS))("%s matches the light token", (name, value) => {
    expect(light).toContain(`--fw-${name}: ${value};`);
  });
});

const dark = css.slice(
  css.indexOf('[data-theme="dark"] {'),
  css.indexOf("}", css.indexOf('[data-theme="dark"] {')),
);

describe("BRAND_COLORS_DARK", () => {
  it.each(Object.entries(BRAND_COLORS_DARK))("%s matches the dark token", (name, value) => {
    expect(dark).toContain(`--fw-${name}: ${value};`);
  });
});
