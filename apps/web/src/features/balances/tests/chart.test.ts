import { describe, expect, it } from "vitest";
import { smoothPath } from "@/features/balances/lib/chart";

// The control points of every curve segment, in order: [c1x, c1y, c2x, c2y, x, y].
const curves = (d: string) =>
  [...d.matchAll(/C([^C]+)/g)].map((m) => (m[1] ?? "").trim().split(/[ ,]+/).map(Number));

describe("smoothPath", () => {
  it("draws straight lines when there are too few points to curve", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([[0, 10]])).toBe("M0.0,10.0");
    expect(
      smoothPath([
        [0, 10],
        [5, 20],
      ]),
    ).toBe("M0.0,10.0L5.0,20.0");
  });

  it("keeps a flat run flat and never curves past a peak or below a trough", () => {
    // y grows downwards in SVG: 90 is the bottom (an empty wallet), 10 the top.
    const d = smoothPath([
      [0, 90],
      [10, 90],
      [20, 10],
      [30, 50],
      [40, 90],
    ]);
    const segments = curves(d);
    expect(segments).toHaveLength(4);
    // Every control point stays within the values around it: no dip under the bottom, no spike above the peak.
    for (const [, c1y, , c2y] of segments) {
      expect(c1y).toBeGreaterThanOrEqual(10);
      expect(c1y).toBeLessThanOrEqual(90);
      expect(c2y).toBeGreaterThanOrEqual(10);
      expect(c2y).toBeLessThanOrEqual(90);
    }
    // The flat start leaves level.
    expect(segments[0]?.[1]).toBe(90);
    expect(d.startsWith("M0.0,90.0C")).toBe(true);
  });
});
