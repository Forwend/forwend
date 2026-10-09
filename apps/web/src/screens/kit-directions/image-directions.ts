import type { Direction, ImageCompSpec } from "@/screens/kit-directions/directions";

// Five more directions drawn from data (ImageComp). Palettes are comp-only colors, like COMP_UI.
export const IMAGE_DIRECTION_IDS = {
  coastalLedger: "coastal-ledger",
  paperAtlas: "paper-atlas",
  auroraNight: "aurora-night",
  terracottaMesa: "terracotta-mesa",
  glassGarden: "glass-garden",
} as const;

export const IMAGE_DIRECTIONS: readonly (Omit<Direction, "id"> & {
  id: (typeof IMAGE_DIRECTION_IDS)[keyof typeof IMAGE_DIRECTION_IDS];
  comp: ImageCompSpec;
})[] = [
  {
    id: IMAGE_DIRECTION_IDS.coastalLedger,
    letter: "D",
    name: "Coastal Ledger",
    summary:
      "Golden-hour cliffs and a footpath to a lighthouse; warm sand, seafoam and a deep navy ink.",
    image: { src: "/images/candidates/d-coastal-ledger.webp", width: 2172, height: 724 },
    comp: {
      palette: {
        ink: "#0E2233",
        muted: "#2E4A5E",
        line: "rgba(14, 34, 51, 0.14)",
        surface: "rgba(255, 252, 245, 0.8)",
        accent: "#0F6E78",
        onInk: "#FFFDF7",
      },
      fontVar: "--font-young-serif",
      layout: "left",
      headline: "Money that reaches the shore.",
      body: "Stablecoin invoices with a clear path from the first transfer to your own wallet.",
      scrim:
        "linear-gradient(90deg, rgba(255,250,240,0.85) 0%, rgba(255,250,240,0.55) 40%, transparent 70%)",
    },
  },
  {
    id: IMAGE_DIRECTION_IDS.paperAtlas,
    letter: "E",
    name: "Paper Atlas",
    summary: "A topographic map with one cobalt route; ink green on paper, editorial and exact.",
    image: { src: "/images/candidates/e-paper-atlas.webp", width: 1942, height: 809 },
    comp: {
      palette: {
        ink: "#14261C",
        muted: "#3D5446",
        line: "rgba(20, 38, 28, 0.16)",
        surface: "rgba(250, 248, 240, 0.9)",
        accent: "#1F44D6",
        onInk: "#FFFFFF",
      },
      fontVar: "--font-instrument",
      layout: "center",
      headline: "Every payment has a route.",
      body: "Detected, confirmed, settled. Follow it like a line on a map.",
      scrim: "radial-gradient(ellipse 60% 55% at 50% 38%, rgba(247,245,236,0.92), transparent 75%)",
    },
  },
  {
    id: IMAGE_DIRECTION_IDS.auroraNight,
    letter: "F",
    name: "Aurora Night",
    summary:
      "Northern lights over a frozen lake; deep navy with green and violet light, bold geometric type.",
    image: { src: "/images/candidates/f-aurora-night.webp", width: 1916, height: 821 },
    comp: {
      palette: {
        ink: "#F2F6FF",
        muted: "#C3CDE6",
        line: "rgba(255, 255, 255, 0.14)",
        surface: "rgba(10, 16, 36, 0.72)",
        accent: "#5CE1B3",
        onInk: "#06121F",
      },
      fontVar: "--font-unbounded",
      layout: "split",
      headline: "Get paid while the world sleeps.",
      body: "Stablecoins move at any hour. Forwend shows each step as it happens.",
      scrim:
        "linear-gradient(90deg, rgba(5,10,28,0.82) 0%, rgba(5,10,28,0.5) 45%, rgba(5,10,28,0.1) 75%), linear-gradient(180deg, rgba(5,10,28,0.35) 0%, transparent 40%, rgba(5,10,28,0.6) 100%)",
    },
  },
  {
    id: IMAGE_DIRECTION_IDS.terracottaMesa,
    letter: "G",
    name: "Terracotta Mesa",
    summary:
      "A desert road to the horizon; terracotta and sand with a high-contrast fashion serif.",
    image: { src: "/images/candidates/g-terracotta-mesa.webp", width: 2172, height: 724 },
    comp: {
      palette: {
        ink: "#2A140C",
        muted: "#5A3A2C",
        line: "rgba(42, 20, 12, 0.16)",
        surface: "rgba(255, 246, 236, 0.86)",
        accent: "#B4441E",
        onInk: "#FFF8F0",
      },
      fontVar: "--font-bodoni",
      layout: "center",
      headline: "Straight to your wallet.",
      body: "No detours. The invoice amount settles where you can see it.",
      scrim:
        "linear-gradient(180deg, rgba(255,244,230,0.94) 0%, rgba(255,244,230,0.85) 42%, rgba(255,244,230,0.2) 62%, transparent 75%)",
    },
  },
  {
    id: IMAGE_DIRECTION_IDS.glassGarden,
    letter: "H",
    name: "Glass Garden",
    summary: "Soft frosted glass in mint and lilac with one glowing line; light, modern and calm.",
    image: { src: "/images/candidates/h-glass-garden.webp", width: 2048, height: 768 },
    comp: {
      palette: {
        ink: "#1B1A2E",
        muted: "#4A4866",
        line: "rgba(27, 26, 46, 0.12)",
        surface: "rgba(255, 255, 255, 0.7)",
        accent: "#6B4EFF",
        onInk: "#FFFFFF",
      },
      fontVar: "--font-sora",
      layout: "left",
      headline: "Payments, made clear.",
      body: "Invoices, checkout and an API for USDC and USDT, with nothing hidden.",
      scrim: "linear-gradient(180deg, rgba(250,250,255,0.6) 0%, transparent 55%)",
    },
  },
];
