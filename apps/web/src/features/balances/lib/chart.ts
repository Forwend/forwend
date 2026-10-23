export function niceTop(max: number): number {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 5, 10].find((n) => n * power >= max) ?? 10;
  return step * power;
}

/** Geometry only, lossy: shown amounts are always formatted from the bigint. */
export function toNumber(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
}

/** Monotone cubic (Fritsch–Carlson): never overshoots, so a balance never dips under zero. */
export function smoothPath(points: readonly (readonly [number, number])[]): string {
  const n = points.length;
  const first = points[0];
  if (!first) return "";
  if (n < 3) return `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}`;
  const dx = (i: number) => (points[i + 1]?.[0] ?? 0) - (points[i]?.[0] ?? 0);
  const slope = (i: number) => ((points[i + 1]?.[1] ?? 0) - (points[i]?.[1] ?? 0)) / (dx(i) || 1);
  const tangents = points.map((_, i) => {
    if (i === 0) return slope(0);
    if (i === n - 1) return slope(n - 2);
    const a = slope(i - 1);
    const b = slope(i);
    // A peak, a trough or a flat step: the curve arrives level, so it cannot overshoot.
    if (a * b <= 0) return 0;
    return (3 * (dx(i - 1) + dx(i))) / ((2 * dx(i) + dx(i - 1)) / a + (dx(i) + 2 * dx(i - 1)) / b);
  });
  let d = `M${first[0].toFixed(1)},${first[1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i] ?? first;
    const [x1, y1] = points[i + 1] ?? first;
    const h = (x1 - x0) / 3;
    const c1 = [x0 + h, y0 + h * (tangents[i] ?? 0)];
    const c2 = [x1 - h, y1 - h * (tangents[i + 1] ?? 0)];
    d += `C${c1.map((v) => v.toFixed(1)).join(",")} ${c2.map((v) => v.toFixed(1)).join(",")} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}
