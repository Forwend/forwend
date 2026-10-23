import type { DIRECTION_IDS } from "@/screens/kit-directions/constants/directions";

export type DirectionId = (typeof DIRECTION_IDS)[keyof typeof DIRECTION_IDS];

export interface Direction {
  id: DirectionId;
  letter: string;
  name: string;
  summary: string;
  /** Hero image for this direction (source and prompt in docs/web/images.md). */
  image: { src: string; width: number; height: number };
}

export type ImageCompLayout = "center" | "left" | "split";

export interface ImageCompSpec {
  palette: Readonly<Record<string, string>>;
  /** CSS variable set by next/font, e.g. "--font-sora". */
  fontVar: string;
  layout: ImageCompLayout;
  headline: string;
  body: string;
  /** Gradient laid over the image so the text reads. */
  scrim: string;
}
