import { describe, expect, it } from "vitest";
import { limiter } from "@/lib/limit";

describe("limiter", () => {
  it("refuses a key past its max until its window ends, counts each key alone, and wait counts nothing", () => {
    const limit = limiter(2, 60_000);
    limit.hit("a", 0);
    expect(limit.wait("a", 1)).toBe(0);
    limit.hit("a", 1);
    expect([limit.wait("a", 30_000), limit.wait("a", 30_000), limit.wait("b", 30_000)]).toEqual([
      30, 30, 0,
    ]);
    expect(limit.wait("a", 60_000)).toBe(0);
  });
});
