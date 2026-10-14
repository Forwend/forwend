import { describe, expect, it } from "vitest";
import { exactDigits } from "@/shared/lib/money";

describe("exactDigits", () => {
  it("shows every decimal an amount has, and at least 2", () => {
    expect(exactDigits(1n, 6)).toBe(6);
    expect(exactDigits(1_234_560_000n, 6)).toBe(2);
    expect(exactDigits(1_123_000n, 6)).toBe(3);
    expect(exactDigits(5n, 0)).toBe(0);
  });
});
