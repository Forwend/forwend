import type { DIRECTION_IDS } from "@/constants/directions";

export type DirectionId = (typeof DIRECTION_IDS)[keyof typeof DIRECTION_IDS];

export interface Direction {
  id: DirectionId;
  letter: string;
  name: string;
  summary: string;
  /** Hero image for this direction (source and prompt in docs/images.md). */
  image: { src: string; width: number; height: number };
}
