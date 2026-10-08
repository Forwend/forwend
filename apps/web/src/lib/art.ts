import type { Dot, HalftoneSpec, RidgeSpec } from "@/types/art/shapes";

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

/** Point at t on a cubic Bézier segment. */
export function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const x = u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0];
  const y = u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1];
  return [Number(x.toFixed(1)), Number(y.toFixed(1))];
}
