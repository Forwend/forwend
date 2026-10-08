import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLOR_TOKENS, DURATION_MS } from "../src";

const css = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/theme.css", import.meta.url), "utf8");

function names(selector: string): string[] {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return [...body.matchAll(/--fw-([a-z0-9-]+):\s*#[0-9a-f]{6};/g)].map((m) => m[1] ?? "");
}

describe("COLOR_TOKENS", () => {
  it.each(['[data-theme="light"]', '[data-theme="dark"]'])(
    "lists exactly the hex color tokens defined in %s",
    (selector) => {
      expect([...COLOR_TOKENS].sort()).toEqual(names(selector).sort());
    },
  );

  it("maps every color token to a Tailwind utility", () => {
    for (const name of COLOR_TOKENS) {
      expect(theme).toContain(`--color-${name}: var(--fw-${name});`);
    }
  });
});

describe("DURATION_MS", () => {
  it.each(Object.entries(DURATION_MS))("%s matches --fw-duration-%s", (name, ms) => {
    expect(css).toContain(`--fw-duration-${name}: ${ms}ms;`);
  });
});
