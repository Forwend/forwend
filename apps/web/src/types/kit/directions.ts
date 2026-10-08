import type { DIRECTION_IDS } from "@/constants/directions";

export type DirectionId = (typeof DIRECTION_IDS)[keyof typeof DIRECTION_IDS];

export interface Direction {
  id: DirectionId;
  letter: string;
  name: string;
  summary: string;
}
