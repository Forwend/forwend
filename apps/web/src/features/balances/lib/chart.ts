export function niceTop(max: number): number {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 5, 10].find((n) => n * power >= max) ?? 10;
  return step * power;
}

/** Geometry only: a pixel position for an exact amount. Shown amounts are always formatted from the bigint. */
export function toNumber(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
}
