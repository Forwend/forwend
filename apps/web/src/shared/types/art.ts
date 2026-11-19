export interface RidgeSpec {
  width: number;
  height: number;
  baseY: number; // viewBox units from the top
  waves: readonly (readonly [number, number, number])[]; // [amplitude, wavelength, phase]
  step?: number;
}
