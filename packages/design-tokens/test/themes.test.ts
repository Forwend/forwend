import { describe, expect, it } from "vitest";
import { THEMES } from "../src";

describe("THEMES", () => {
  it("lists the light and dark themes", () => {
    expect(Object.values(THEMES)).toEqual(["light", "dark"]);
  });
});
