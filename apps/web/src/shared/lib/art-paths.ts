import type { Dot, HalftoneSpec, RidgeSpec } from "@/shared/types/art";

export function ridgeY(x: number, spec: RidgeSpec): number {
  return spec.waves.reduce(
    (y, [amplitude, wavelength, phase]) =>
      y + amplitude * Math.sin((x / wavelength) * Math.PI * 2 + phase),
    spec.baseY,
  );
}

// Closed shape from a sum of sines down to the bottom edge. Deterministic, so server and client match.
export function ridgePath(spec: RidgeSpec): string {
  const step = spec.step ?? 16;
  let d = `M0 ${spec.height} L0 ${ridgeY(0, spec).toFixed(1)}`;
  for (let x = step; x <= spec.width; x += step) {
    d += ` L${x} ${ridgeY(x, spec).toFixed(1)}`;
  }
  return `${d} L${spec.width} ${spec.height} Z`;
}

// A pine as three stacked triangles on a short trunk.
export function pinePath(x: number, baseY: number, height: number): string {
  const w = height * 0.36;
  const tiers = [0, 0.3, 0.55].map((t, i) => {
    const top = baseY - height + t * height;
    const bottom = top + height * (0.48 - i * 0.04);
    const half = w * (0.55 + i * 0.22);
    return `M${x} ${top.toFixed(1)} L${(x + half).toFixed(1)} ${bottom.toFixed(1)} L${(x - half).toFixed(1)} ${bottom.toFixed(1)} Z`;
  });
  const trunk = `M${x - w * 0.06} ${baseY - height * 0.08} h${w * 0.12} v${height * 0.08} h${-w * 0.12} Z`;
  return [...tiers, trunk].join(" ");
}

// Dots grow from nothing at the edge to full size `ramp` rows below it.
export function halftoneDots(spec: HalftoneSpec): Dot[] {
  const dots: Dot[] = [];
  const max = spec.cell * 0.46;
  for (let y = spec.cell / 2; y < spec.height; y += spec.cell) {
    for (let x = spec.cell / 2; x < spec.width; x += spec.cell) {
      const depth = (y - spec.edge(x)) / (spec.ramp * spec.cell);
      if (depth <= 0) continue;
      const r = max * Math.min(1, Math.sqrt(depth));
      if (r > 0.6) dots.push({ cx: x, cy: y, r: Number(r.toFixed(2)) });
    }
  }
  return dots;
}

// Small seeded generator (mulberry32) so tree placement is stable between renders.
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Point = readonly [number, number];

type Cubic = readonly [Point, Point, Point, Point];

// Catmull-Rom through the points, as one cubic Bézier per pair of neighbours.
function smoothSegments(points: readonly Point[]): Cubic[] {
  const segments: Cubic[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    if (!p0 || !p1 || !p2 || !p3) continue;
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    segments.push([p1, c1, c2, p2]);
  }
  return segments;
}

/** Smooth path through the points (Catmull-Rom converted to cubic Béziers). */
export function smoothPath(points: readonly Point[]): string {
  const [first] = points;
  if (!first) return "";
  let d = `M${first[0]} ${first[1]}`;
  for (const [, c1, c2, p2] of smoothSegments(points)) {
    d += ` C${c1.map((v) => v.toFixed(1)).join(" ")} ${c2.map((v) => v.toFixed(1)).join(" ")} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/** For each point after the first, the share of smoothPath's length drawn when the line reaches it. */
export function smoothPathShares(points: readonly Point[]): number[] {
  const lengths = smoothSegments(points).map(([p1, c1, c2, p2]) => {
    let length = 0;
    let prev = p1;
    for (let i = 1; i <= 32; i++) {
      const t = i / 32;
      const u = 1 - t;
      const at = (k: 0 | 1) =>
        u * u * u * p1[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p2[k];
      const next: Point = [at(0), at(1)];
      length += Math.hypot(next[0] - prev[0], next[1] - prev[1]);
      prev = next;
    }
    return length;
  });
  const total = lengths.reduce((a, b) => a + b, 0);
  let drawn = 0;
  return lengths.map((length) => {
    drawn += length;
    return drawn / total;
  });
}
