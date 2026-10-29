import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing ${selector} block in tokens.css`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/--fw-([a-z0-9-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]),
  );
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const BODY = 4.5;
const LARGE = 3;

// [text, background, minimum]: every pairing the components use.
const PAIRS: readonly (readonly [string, string, number])[] = [
  ["ink", "bg", BODY],
  ["ink", "surface", BODY],
  ["ink", "surface-2", BODY],
  ["ink", "sunken", BODY],
  ["muted", "bg", BODY],
  ["muted", "surface", BODY],
  ["muted", "surface-2", BODY],
  ["subtle", "bg", BODY],
  ["subtle", "surface", BODY],
  ["accent", "bg", BODY],
  ["accent", "surface", BODY],
  ["on-primary", "primary", BODY],
  ["on-accent", "accent", BODY],
  ["on-brand", "brand", BODY],
  ["on-brand", "brand-hover", BODY],
  ["success", "success-soft", BODY],
  ["warning", "warning-soft", BODY],
  ["danger", "danger-soft", BODY],
  ["info", "info-soft", BODY],
  // The accent badge: olive text on the info ground (ui-web tone.ts).
  ["accent", "info-soft", BODY],
  ["muted", "sunken", BODY],
  ["subtle", "sunken", BODY],
  ["subtle", "surface-2", BODY],
  ["info", "surface", BODY],
  ["success", "surface", BODY],
  ["warning", "surface", BODY],
  ["danger", "surface", BODY],
  ["focus", "bg", LARGE],
  ["line-strong", "bg", 1.5],
];

describe.each(['[data-theme="light"]', '[data-theme="dark"]'])("tokens in %s", (selector) => {
  const colors = block(selector);

  it.each(PAIRS)("%s on %s meets %d:1", (text, bg, min) => {
    const fg = colors[text];
    const ground = colors[bg];
    expect(fg, `--fw-${text} missing`).toBeDefined();
    expect(ground, `--fw-${bg} missing`).toBeDefined();
    expect(contrast(fg ?? "", ground ?? "")).toBeGreaterThanOrEqual(min);
  });
});
