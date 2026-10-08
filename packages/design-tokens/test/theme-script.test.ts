import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "../src";

function run(stored: string | null, prefersDark: boolean): string | null {
  const attrs: Record<string, string> = {};
  const env = {
    localStorage: { getItem: (k: string) => (k === THEME_STORAGE_KEY ? stored : null) },
    matchMedia: () => ({ matches: prefersDark }),
    document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
  };
  new Function("localStorage", "matchMedia", "document", THEME_INIT_SCRIPT)(
    env.localStorage,
    env.matchMedia,
    env.document,
  );
  return attrs["data-theme"] ?? null;
}

describe("THEME_INIT_SCRIPT", () => {
  afterEach(() => vi.restoreAllMocks());

  it("follows the system preference when nothing is saved", () => {
    expect(run(null, true)).toBe("dark");
    expect(run(null, false)).toBe("light");
  });

  it("uses the saved choice over the system preference", () => {
    expect(run("light", true)).toBe("light");
    expect(run("dark", false)).toBe("dark");
  });

  it("ignores an unknown saved value", () => {
    expect(run("purple", true)).toBe("dark");
  });
});
