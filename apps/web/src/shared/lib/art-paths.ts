import type { RidgeSpec } from "@/shared/types/art";

export function ridgeY(x: number, spec: RidgeSpec): number {
  return spec.waves.reduce(
    (y, [amplitude, wavelength, phase]) =>
      y + amplitude * Math.sin((x / wavelength) * Math.PI * 2 + phase),
    spec.baseY,
  );
}

// Deterministic, so server and client render the same path.
export function ridgePath(spec: RidgeSpec): string {
  const step = spec.step ?? 16;
  let d = `M0 ${spec.height} L0 ${ridgeY(0, spec).toFixed(1)}`;
  for (let x = step; x <= spec.width; x += step) {
    d += ` L${x} ${ridgeY(x, spec).toFixed(1)}`;
  }
  return `${d} L${spec.width} ${spec.height} Z`;
}
