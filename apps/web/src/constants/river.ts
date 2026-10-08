import { cubicPoint } from "@/lib/art";

// Centerline of the river in DawnLandscape (viewBox 1600x1000), as three cubic segments.
const S1 = [
  [802, 682],
  [800, 712],
  [812, 730],
  [806, 752],
] as const;
const S2 = [
  [806, 752],
  [798, 792],
  [758, 822],
  [766, 872],
] as const;
const S3 = [
  [766, 872],
  [772, 922],
  [800, 962],
  [815, 1000],
] as const;

export const RIVER_PATH = `M${S1[0].join(" ")} C${[S1[1], S1[2], S1[3]].map((p) => p.join(" ")).join(" ")} C${[S2[1], S2[2], S2[3]].map((p) => p.join(" ")).join(" ")} C${[S3[1], S3[2], S3[3]].map((p) => p.join(" ")).join(" ")}`;

/** One mark per payment step, from the horizon toward the visitor. */
export const RIVER_MARKS = [
  cubicPoint(...S1, 0.25),
  cubicPoint(...S2, 0.15),
  cubicPoint(...S2, 0.85),
  cubicPoint(...S3, 0.7),
] as const;
