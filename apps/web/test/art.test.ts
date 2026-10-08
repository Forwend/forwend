import { describe, expect, it } from "vitest";
import { halftoneDots, ridgePath } from "@/lib/art";

describe("art helpers", () => {
  it("closes ridge shapes at the bottom corners", () => {
    const d = ridgePath({ width: 100, height: 50, baseY: 20, waves: [[5, 50, 0]] });
    expect(d.startsWith("M0 50")).toBe(true);
    expect(d.endsWith("L100 50 Z")).toBe(true);
  });

  it("puts no halftone dots above the edge and full dots deep below it", () => {
    const dots = halftoneDots({ width: 100, height: 100, cell: 10, edge: () => 50, ramp: 2 });
    expect(dots.every((d) => d.cy > 50)).toBe(true);
    expect(Math.max(...dots.map((d) => d.r))).toBeCloseTo(4.6);
  });
});
