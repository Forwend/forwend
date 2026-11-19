import type { DIRECTION_IDS } from "@/screens/kit-directions/constants/directions";

export type DirectionId = (typeof DIRECTION_IDS)[keyof typeof DIRECTION_IDS];

export interface Direction {
  id: DirectionId;
  letter: string;
  name: string;
  summary: string;
  image: { src: string; width: number; height: number };
}

export interface ImageCompSpec {
  palette: Readonly<Record<string, string>>;
  fontVar: string; // e.g. "--font-sora"
  layout: "center" | "left" | "split";
  headline: string;
  body: string;
  scrim: string; // CSS gradient laid over the image
}

export interface ImageDirection extends Omit<Direction, "id"> {
  id: string;
  comp: ImageCompSpec;
}
