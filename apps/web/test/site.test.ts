import { describe, expect, it } from "vitest";
import { SITE } from "@/constants/site";

describe("SITE", () => {
  it("names the product Forwend", () => {
    expect(SITE.name).toBe("Forwend");
  });
});
