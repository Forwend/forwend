import type { Direction } from "@/types/kit/directions";

export const DIRECTION_IDS = {
  dawnPath: "dawn-path",
  duskLedger: "dusk-ledger",
  halftoneHorizon: "halftone-horizon",
} as const;

export const DIRECTIONS: readonly Direction[] = [
  {
    id: DIRECTION_IDS.dawnPath,
    letter: "A",
    name: "Dawn Path",
    summary:
      "Light dawn valley, serif headline, a river that doubles as the payment's progress line.",
    image: { src: "/images/hero-dawn.webp", width: 1672, height: 941 },
  },
  {
    id: DIRECTION_IDS.duskLedger,
    letter: "B",
    name: "Dusk Ledger",
    summary: "Dusk ridges falling into near-black framed product sections with a warm accent.",
    image: { src: "/images/checkout-dusk.webp", width: 1916, height: 821 },
  },
  {
    id: DIRECTION_IDS.halftoneHorizon,
    letter: "C",
    name: "Halftone Horizon",
    summary:
      "A ridge of cobalt halftone dots that rises like a chart line, on a cool light ground.",
    image: { src: "/images/candidates/hero-c-halftone-horizon.webp", width: 2043, height: 770 },
  },
];
