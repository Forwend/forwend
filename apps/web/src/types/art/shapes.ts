export interface RidgeSpec {
  width: number;
  height: number;
  /** Baseline of the ridge, in viewBox units from the top. */
  baseY: number;
  /** Sine layers as [amplitude, wavelength, phase]. */
  waves: readonly (readonly [number, number, number])[];
  step?: number;
}

export interface Dot {
  cx: number;
  cy: number;
  r: number;
}

export interface HalftoneSpec {
  width: number;
  height: number;
  cell: number;
  /** Height of the filled area's top edge at x. */
  edge: (x: number) => number;
  /** Rows below the edge before dots reach full size. */
  ramp: number;
}

export interface HalftoneRidgeProps {
  className?: string;
  /** Light dots with no ground, for use as a background texture. */
  soft?: boolean;
}
